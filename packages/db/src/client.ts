import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { schema } from './schema.js'

export function createDb(databaseUrl = process.env.DATABASE_URL) {
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not set. Copy .env.example to .env and start Postgres.')
  }
  const client = postgres(databaseUrl, { max: 5, idle_timeout: 20 })
  const db = drizzle(client, { schema })
  return { db, client }
}

export type Database = ReturnType<typeof createDb>['db']
