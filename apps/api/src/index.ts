import { serve } from '@hono/node-server'
import { sql } from 'drizzle-orm'
import { createDb } from '@bookbound/db'
import { loadEnv } from '@bookbound/shared/env'
import { createApp } from './app'
import type { Database } from '@bookbound/db'

loadEnv(import.meta.url)

const state: { db: Database | null } = { db: null }
const app = createApp(state)
const port = Number(process.env.API_PORT ?? 8787)

serve({ fetch: app.fetch, port }, () => {
  console.log(`API listening on ${port}`)
})

async function connect() {
  for (;;) {
    try {
      const { db } = createDb()
      await db.execute(sql`select 1`)
      state.db = db
      console.log('API connected to Postgres')
      return
    } catch (error) {
      state.db = null
      const message = error instanceof Error ? error.message : 'unknown error'
      console.error(`Waiting for Postgres. ${message}`)
      await new Promise((resolve) => setTimeout(resolve, 2000))
    }
  }
}

void connect()
