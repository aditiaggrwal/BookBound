import { and, asc, eq, sql } from 'drizzle-orm'
import { enrichmentJobs, type Database } from '@bookbound/db'
import { enrichBook } from './enrichment/enrich'
import { resolveMode } from './enrichment/llm'

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function claimJob(db: Database) {
  try {
    const claimed = await db.execute<{ id: string; book_id: string; attempts: number }>(sql`
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
    `)
    const rows = Array.isArray(claimed) ? claimed : ((claimed as { rows?: Array<{ id: string; book_id: string; attempts: number }> }).rows ?? [])
    if (rows[0]) return rows[0]
  } catch {
    // PGlite and some poolers do not support SKIP LOCKED the same way.
  }

  const pending = await db
    .select({ id: enrichmentJobs.id, bookId: enrichmentJobs.bookId, attempts: enrichmentJobs.attempts })
    .from(enrichmentJobs)
    .where(eq(enrichmentJobs.status, 'pending'))
    .orderBy(asc(enrichmentJobs.createdAt))
    .limit(1)
  const job = pending[0]
  if (!job) return null
  const updated = await db
    .update(enrichmentJobs)
    .set({
      status: 'running',
      startedAt: new Date(),
      attempts: job.attempts + 1,
    })
    .where(and(eq(enrichmentJobs.id, job.id), eq(enrichmentJobs.status, 'pending')))
    .returning()
  const row = updated[0]
  if (!row) return null
  return { id: row.id, book_id: row.bookId, attempts: row.attempts }
}

export async function startEnrichmentLoop(db: Database, options?: { signal?: AbortSignal }) {
  console.log(`Enrichment worker starting in ${resolveMode()} mode`)
  if (resolveMode() === 'gemini') console.log(`Tagging with ${process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'}`)
  if ((resolveMode() === 'anthropic' || resolveMode() === 'gemini') && !process.env.OPENAI_API_KEY) {
    console.log('Embeddings are using the local fixture because OPENAI_API_KEY is not set.')
  }

  let limitStreak = 0
  while (!options?.signal?.aborted) {
    const job = await claimJob(db)
    if (!job) {
      await sleep(1500)
      continue
    }
    try {
      await enrichBook(db, job.book_id)
      await db
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
        await db
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
      await db
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
}
