import { sql } from 'drizzle-orm'
import { createDb } from '@bookbound/db'
import { loadEnv } from '@bookbound/shared/env'
import { startEnrichmentLoop } from './loop'

loadEnv(import.meta.url)

const abort = new AbortController()
process.on('SIGINT', () => abort.abort())
process.on('SIGTERM', () => abort.abort())

const connection = await waitForDb()
try {
  await startEnrichmentLoop(connection.db, { signal: abort.signal })
} finally {
  await connection.close()
}

async function waitForDb() {
  for (;;) {
    let conn: Awaited<ReturnType<typeof createDb>> | null = null
    try {
      conn = await createDb()
      await conn.db.execute(sql`select 1`)
      console.log(`Worker connected to ${conn.kind === 'pglite' ? 'local PGlite' : 'Postgres'}`)
      return conn
    } catch (error) {
      if (conn) await conn.close().catch(() => undefined)
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(`Waiting for database. ${message}`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}
