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

/**
 * Hosted / Postgres path only. Local PGlite lives in `./localClient` so the
 * serverless bundle never pulls in the WASM package.
 */
export async function createDb(databaseUrl = process.env.DATABASE_URL): Promise<DbHandle> {
  const url = databaseUrl?.trim() ?? ''
  if (url === '') {
    throw new Error('DATABASE_URL is not set')
  }

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
