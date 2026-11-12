import { loadEnv } from '@bookbound/shared/env'
import { createDb } from './client'

loadEnv(import.meta.url)

const url = process.env.DATABASE_URL?.trim() ?? ''
if (url === '') {
  console.log('migrate: DATABASE_URL unset; local PGlite applies migrations on startup')
  process.exit(0)
}

const { close } = await createDb(url)
await close()
console.log('Database connection is ready. Schema is applied by scripts/migrate-app.mjs during build.')
