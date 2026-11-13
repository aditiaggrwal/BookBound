import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { createDb, type Database } from '@bookbound/db'
import { createLocalDb } from '@bookbound/db/local'
import { loadEnv } from '@bookbound/shared/env'
import { startEnrichmentLoop } from '@bookbound/worker/loop'
import { createApp } from './app'

loadEnv(import.meta.url)

// Cookie Secure defaults are decided per-request in session.ts.


const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const webDist = join(root, 'public')
const state: { db: Database | null } = { db: null }
const api = createApp(state)
const app = new Hono()

app.route('/', api)
app.use('/*', serveStatic({ root: './public' }))

app.get('*', async (c) => {
  if (c.req.path.startsWith('/api/')) return c.json({ message: 'Not found.' }, 404)
  try {
    const html = await readFile(join(webDist, 'index.html'), 'utf8')
    return c.html(html)
  } catch {
    return c.text('BookBound UI is not built yet. Run the web build first.', 503)
  }
})


const port = Number(process.env.PORT ?? process.env.API_PORT ?? 8787)
const abort = new AbortController()

serve({ fetch: app.fetch, port }, () => {
  console.log(`BookBound listening on ${port}`)
})

async function connect() {
  for (;;) {
    try {
      const handle = process.env.DATABASE_URL?.trim() ? await createDb() : await createLocalDb()
      await handle.db.execute(sql`select 1`)
      state.db = handle.db
      console.log(`API connected to ${handle.kind === 'pglite' ? 'local PGlite' : 'Postgres'}`)
      void startEnrichmentLoop(handle.db, { signal: abort.signal })
      return
    } catch (error) {
      state.db = null
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(`Waiting for database. ${message}`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

void connect()

process.on('SIGINT', () => abort.abort())
process.on('SIGTERM', () => abort.abort())
