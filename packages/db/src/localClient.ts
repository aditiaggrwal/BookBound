import { readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Database, DbHandle } from './client.js'
import { schema } from './schema.js'

const rootDir = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/** In-memory PGlite for local/dev only. Do not import from the hosted API entry. */
export async function createLocalDb(): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite')
  const { drizzle: drizzlePglite } = await import('drizzle-orm/pglite')
  const pglite = new PGlite()
  const migrationsDir = join(rootDir, 'migrations')
  const files = (await readdir(migrationsDir).catch(() => []))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const file of files) {
    await pglite.exec(await readFile(join(migrationsDir, file), 'utf8'))
  }
  const db = drizzlePglite(pglite, { schema }) as unknown as Database
  return {
    db,
    kind: 'pglite',
    close: async () => {
      await pglite.close()
    },
  }
}
