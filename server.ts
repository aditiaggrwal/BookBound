import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDb, migrateRuntime, type Database } from '@bookbound/db'
import { createApp } from './apps/api/src/app'

// Cookie Secure defaults are decided per-request in session.ts.

const state: { db: Database | null; kind: 'postgres' | 'pglite' | null; lastError: string | null } = {
  db: null,
  kind: null,
  lastError: null,
}
let connecting: Promise<void> | null = null

async function ensureDb(): Promise<void> {
  if (state.db) return
  if (!connecting) {
    connecting = (async () => {
      await migrateRuntime()
      const handle = await createDb()
      await handle.db.execute(sql`select 1`)
      // Confirm the import tables exist even if a prior publish marked migrations done early.
      await handle.db.execute(sql`select 1 from import_batches limit 1`)
      state.db = handle.db
      state.kind = handle.kind
      state.lastError = null
    })()
      .catch((error) => {
        state.db = null
        state.kind = null
        state.lastError = error instanceof Error ? error.message.slice(0, 180) : 'unknown error'
        throw error
      })
      .finally(() => {
        connecting = null
      })
  }
  await connecting
}

const app = new Hono()

app.notFound((c) => {
  if (c.req.path.startsWith('/api/')) {
    return c.json({ message: 'That API route was not found.' }, 404)
  }
  return c.text('Not found', 404)
})

app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/health') {
    try {
      await ensureDb()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(`Database unavailable. ${message}`)
    }
    return next()
  }

  try {
    await ensureDb()
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    console.error(`Database unavailable. ${message}`)
    return c.json({ message: 'BookBound could not open its database. Try again in a moment.' }, 503)
  }

  await next()

  if (state.db && c.req.path !== '/api/health') {
    // Keep the worker out of the cold-start module graph.
    void import('./apps/worker/src/loop')
      .then(({ processEnrichmentBatch }) => processEnrichmentBatch(state.db!, 1))
      .catch((error) => {
        console.error(error)
      })
  }
})

app.get('/api/health', (c) =>
  c.json({
    ok: state.db !== null,
    kind: state.kind,
    error: state.db ? null : state.lastError,
  }),
)

app.route('/', createApp(state))

export default app
