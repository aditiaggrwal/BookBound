import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from './schema.js'

export type Database = ReturnType<typeof drizzlePostgres<typeof schema>>

export type DbHandle = {
  db: Database
  close: () => Promise<void>
  kind: 'postgres' | 'pglite'
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../../..')

function postgresOptions(url: string) {
  const local = /localhost|127\.0\.0\.1/.test(url)
  return {
    max: 5,
    idle_timeout: 20,
    connect_timeout: 15,
    // Verify the server certificate on hosted Postgres.
    ssl: local ? false : ({ rejectUnauthorized: true } as const),
  }
}

export async function createDb(databaseUrl = process.env.DATABASE_URL): Promise<DbHandle> {
  const url = databaseUrl?.trim() ?? ''
  if (url !== '') {
    const client = postgres(url, postgresOptions(url))
    const db = drizzlePostgres(client, { schema })
    return {
      db,
      kind: 'postgres',
      close: async () => {
        await client.end({ timeout: 1 })
      },
    }
  }

  // Load PGlite only for local/dev so the hosted function stays lean.
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite')
  const pglite = await startLocal(PGlite)
  const db = drizzlePglite(pglite, { schema }) as unknown as Database
  return {
    db,
    kind: 'pglite',
    close: async () => {
      await pglite.close()
    },
  }
}

async function startLocal(PGlite: typeof import('@electric-sql/pglite').PGlite) {
  const db = new PGlite()
  const migrationsDir = join(rootDir, 'migrations')
  const files = (await readdir(migrationsDir).catch(() => []))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const file of files) {
    await db.exec(await readFile(join(migrationsDir, file), 'utf8'))
  }
  return db
}
