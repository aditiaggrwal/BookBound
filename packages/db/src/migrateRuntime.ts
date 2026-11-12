import postgres from 'postgres'
import { INIT_SQL } from './initSql.js'

function postgresOptions(url: string) {
  const local = /localhost|127\.0\.0\.1/.test(url)
  return {
    max: 1,
    idle_timeout: 5,
    connect_timeout: 15,
    ssl: local ? false : ('require' as const),
  }
}

/**
 * Apply the bootstrap schema at runtime. Safe to call on every cold start:
 * statements use IF NOT EXISTS, and schema_migrations records completion.
 */
export async function migrateRuntime(databaseUrl = process.env.DATABASE_URL): Promise<void> {
  const url = process.env.DATABASE_URL_UNPOOLED?.trim() || databaseUrl?.trim() || ''
  if (url === '') return

  const sql = postgres(url, postgresOptions(url))
  try {
    await sql`
      create table if not exists schema_migrations (
        name text primary key,
        applied_at timestamptz not null default now()
      )
    `
    const done = await sql<{ name: string }[]>`
      select name from schema_migrations where name = ${'001_init.sql'}
    `
    if (done.length > 0) {
      // Older publishes may have recorded the migration before tables existed.
      const tables = await sql<{ exists: boolean }[]>`
        select to_regclass('public.import_batches') is not null as exists
      `
      if (tables[0]?.exists) return
    }

    const statements = INIT_SQL.split(';')
      .map((part) => part.trim())
      .filter((part) => part.length > 0)

    await sql.begin(async (tx) => {
      for (const statement of statements) {
        await tx.unsafe(statement)
      }
      await tx`
        insert into schema_migrations (name) values (${'001_init.sql'})
        on conflict (name) do nothing
      `
    })
  } finally {
    await sql.end({ timeout: 5 })
  }
}
