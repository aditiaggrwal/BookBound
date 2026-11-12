import { readFile } from 'node:fs/promises'
import { Client } from 'pg'
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
      await migrate()
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

// The build migrates only when DATABASE_URL exists at build time. The hosted
// database is attached at runtime, so create the tables on first use.
async function migrate(): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() || process.env.DATABASE_URL?.trim() || ''
  if (url === '') return
  const file = await readFile(new URL('./migrations/001_init.sql', import.meta.url), 'utf8')
  const statements = file
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    await client.query("set lock_timeout = '60s'")
    await client.query('select pg_advisory_lock(7272741)')
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    )
    const done = await client.query('select 1 from schema_migrations where name = $1', ['001_init.sql'])
    if ((done.rowCount ?? 0) > 0) return
    await client.query('begin')
    try {
      for (const statement of statements) await client.query(statement)
      await client.query('insert into schema_migrations (name) values ($1) on conflict (name) do nothing', [
        '001_init.sql',
      ])
      await client.query('commit')
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  } finally {
    await client.end()
  }
}

export default app
