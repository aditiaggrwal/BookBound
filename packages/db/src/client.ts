import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { drizzle as drizzlePglite } from 'drizzle-orm/pglite'
import { drizzle as drizzlePostgres } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from './schema.js'

export type Database =
  | ReturnType<typeof drizzlePostgres<typeof schema>>
  | ReturnType<typeof drizzlePglite<typeof schema>>

export type DbHandle = {
  db: Database
  close: () => Promise<void>
  kind: 'postgres' | 'pglite'
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../../..')

export async function createDb(databaseUrl = process.env.DATABASE_URL): Promise<DbHandle> {
  const url = databaseUrl?.trim() ?? ''
  if (url !== '') {
    const client = postgres(url, { max: 5, idle_timeout: 20 })
    const db = drizzlePostgres(client, { schema })
    return {
      db,
      kind: 'postgres',
      close: async () => {
        await client.end({ timeout: 1 })
      },
    }
  }

  const pglite = await startLocal()
  const db = drizzlePglite(pglite, { schema })
  return {
    db,
    kind: 'pglite',
    close: async () => {
      await pglite.close()
    },
  }
}

async function startLocal(): Promise<PGlite> {
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
