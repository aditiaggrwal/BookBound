import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDb, type Database } from '@bookbound/db'
import { createApp } from './apps/api/src/app'
import { processEnrichmentBatch } from './apps/worker/src/loop'

if (process.env.COOKIE_SECURE === undefined && (process.env.VERCEL || process.env.NODE_ENV === 'production')) {
  process.env.COOKIE_SECURE = 'true'
}

const state: { db: Database | null } = { db: null }
let connecting: Promise<void> | null = null

async function ensureDb(): Promise<void> {
  if (state.db) return
  if (!connecting) {
    connecting = (async () => {
      const handle = await createDb()
      await handle.db.execute(sql`select 1`)
      state.db = handle.db
    })()
      .catch((error) => {
        state.db = null
        throw error
      })
      .finally(() => {
        connecting = null
      })
  }
  await connecting
}

const app = new Hono()

app.use('/api/*', async (c, next) => {
  try {
    await ensureDb()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error(`Database unavailable. ${message}`)
  }
  await next()
  if (state.db && c.req.path !== '/api/health') {
    void processEnrichmentBatch(state.db, 1).catch((error) => {
      console.error(error)
    })
  }
})

app.route('/', createApp(state))

export default app
