import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import type { MiddlewareHandler } from 'hono'
import { createDb, migrateRuntime, type Database } from '@bookbound/db'
import { createApp } from './apps/api/src/app'

// Cookie Secure defaults are decided per-request in session.ts.

const state: { db: Database | null; kind: 'postgres' | 'pglite' | null; lastError: string | null } = {
  db: null,
  kind: null,
  lastError: null,
}
let connecting: Promise<void> | null = null

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error)
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[db-url]')
    .replace(/password=[^\s&]+/gi, 'password=[redacted]')
    .slice(0, 180)
}

async function ensureDb(): Promise<void> {
  if (state.db) return
  if (!connecting) {
    connecting = (async () => {
      await migrateRuntime()
      // Hosted entry must use createDb (Postgres only) so PGlite stays out of the bundle.
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
        state.lastError = sanitizeError(error)
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
  if (c.req.path.startsWith('/api/') || c.req.path === '/api') {
    return c.json({ message: 'That API route was not found.', path: c.req.path }, 404)
  }
  return c.text('Not found', 404)
})

const withDb: MiddlewareHandler = async (c, next) => {
  if (c.req.path === '/api/health') {
    try {
      await ensureDb()
    } catch (error) {
      console.error(`Database unavailable. ${sanitizeError(error)}`)
    }
    await next()
    return
  }

  try {
    await ensureDb()
  } catch (error) {
    console.error(`Database unavailable. ${sanitizeError(error)}`)
    return c.json({ message: 'BookBound could not open its database. Try again in a moment.' }, 503)
  }

  await next()
}

// Match both `/api` (collapsed rewrites) and `/api/*`.
app.use('/api', withDb)
app.use('/api/*', withDb)

app.get('/api/health', (c) => c.json({ ok: state.db !== null }))

app.route('/', createApp(state))

export default app
