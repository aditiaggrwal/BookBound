import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import pg from 'pg'
import { poolOptions } from './pgOptions.js'
import { schema } from './schema.js'

export type Database = ReturnType<typeof drizzlePg<typeof schema>>

export type DbHandle = {
  db: Database
  close: () => Promise<void>
  kind: 'postgres' | 'pglite'
}

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../../..')

export async function createDb(databaseUrl = process.env.DATABASE_URL): Promise<DbHandle> {
  const url = databaseUrl?.trim() ?? ''
  if (url !== '') {
    // Cursor Apps / hosted Postgres: use node-postgres, matching the platform skill.
    const pool = new pg.Pool(poolOptions(url))
    const db = drizzlePg(pool, { schema })
    return {
      db,
      kind: 'postgres',
      close: async () => {
        await pool.end()
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
