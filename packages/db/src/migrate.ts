import { readFileSync } from 'node:fs'
import { loadEnv } from '@bookbound/shared/env'
import { createDb } from './client'

loadEnv(import.meta.url)

const sqlText = readFileSync(new URL('../sql/001_init.sql', import.meta.url), 'utf8')
const statements = sqlText
  .split(/;\s*\n/)
  .map((statement) => statement.trim())
  .filter((statement) => statement.length > 0)

const { client } = createDb()

for (const statement of statements) {
  await client.unsafe(statement)
}

await client.end()
console.log('Database schema is ready.')
