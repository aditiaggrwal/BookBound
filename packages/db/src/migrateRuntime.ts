import pg from 'pg'
import { INIT_SQL } from './initSql.js'
import { connectionOptions } from './pgOptions.js'

/**
 * Apply the bootstrap schema at runtime. Safe to call on every cold start:
 * statements use IF NOT EXISTS, and schema_migrations records completion.
 */
export async function migrateRuntime(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() || databaseUrl?.trim() || ''
  if (url === '') return

  const client = new pg.Client(connectionOptions(url))
  await client.connect()
  try {
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `)
    const done = await client.query<{ name: string }>(
      `select name from schema_migrations where name = $1`,
      ['001_init.sql'],
    )
    if (done.rows.length > 0) {
      // Older publishes may have recorded the migration before tables existed.
      const tables = await client.query<{ exists: boolean }>(
        `select to_regclass('public.import_batches') is not null as exists`,
      )
      if (tables.rows[0]?.exists) return
    }

    const statements = INIT_SQL.split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    await client.query('begin')
    try {
      for (const statement of statements) {
        await client.query(statement)
      }
      await client.query(`insert into schema_migrations (name) values ($1) on conflict (name) do nothing`, [
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
