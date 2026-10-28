import { sql } from 'drizzle-orm'
import { createDb, enrichmentJobs } from '@bookbound/db'
import { eq } from 'drizzle-orm'
import { loadEnv } from '@bookbound/shared/env'
import { enrichBook } from './enrichment/enrich'
import { resolveMode } from './enrichment/llm'

loadEnv(import.meta.url)

let stopped = false
process.on('SIGINT', () => {
  stopped = true
})
process.on('SIGTERM', () => {
  stopped = true
})

console.log(`Enrichment worker starting in ${resolveMode()} mode`)
if (resolveMode() === 'gemini') console.log(`Tagging with ${process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'}`)
if ((resolveMode() === 'anthropic' || resolveMode() === 'gemini') && !process.env.OPENAI_API_KEY) {
  console.log('Embeddings are using the local fixture because OPENAI_API_KEY is not set.')
}

const connection = await waitForDb()
let limitStreak = 0

while (!stopped) {
  const claimed = await connection.client<{ id: string; book_id: string; attempts: number }[]>`
    UPDATE enrichment_jobs
    SET status = 'running', started_at = now(), attempts = attempts + 1
    WHERE id = (
      SELECT id FROM enrichment_jobs
      WHERE status = 'pending'
      ORDER BY created_at
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING id, book_id, attempts
  `
  const job = claimed[0]
  if (!job) {
    await sleep(1500)
    continue
  }
  try {
    await enrichBook(connection.db, job.book_id)
    await connection.db
      .update(enrichmentJobs)
      .set({ status: 'done', finishedAt: new Date(), error: null })
      .where(eq(enrichmentJobs.id, job.id))
    console.log(`Tagged book ${job.book_id}`)
    limitStreak = 0
    if (resolveMode() === 'gemini') await sleep(2000)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tagging failed.'
    const limited = message.includes('returned 429')
    if (limited) {
      limitStreak += 1
      await connection.db
        .update(enrichmentJobs)
        .set({ status: 'pending', attempts: 0, error: message, finishedAt: null })
        .where(eq(enrichmentJobs.id, job.id))
      const pause = Math.min(limitStreak, 15) * 60_000
      console.error(`Gemini rate limit reached. Pausing ${Math.round(pause / 1000)}s before the next book.`)
      await sleep(pause)
      continue
    }
    limitStreak = 0
    const retry = job.attempts < 3
    await connection.db
      .update(enrichmentJobs)
      .set({
        status: retry ? 'pending' : 'failed',
        error: message,
        finishedAt: retry ? null : new Date(),
      })
      .where(eq(enrichmentJobs.id, job.id))
    console.error(`Tagging ${job.book_id} failed: ${message}`)
    await sleep(retry ? 2000 : 500)
  }
}

await connection.client.end()

async function waitForDb() {
  for (;;) {
    let conn: ReturnType<typeof createDb> | null = null
    try {
      conn = createDb()
      await conn.db.execute(sql`select 1`)
      console.log('Worker connected to Postgres')
      return conn
    } catch (error) {
      if (conn) await conn.client.end({ timeout: 1 }).catch(() => undefined)
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(`Waiting for Postgres. ${message}`)
      await sleep(2000)
    }
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
