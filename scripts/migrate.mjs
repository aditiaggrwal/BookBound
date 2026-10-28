import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const tsx = join(root, 'packages/db/node_modules/.bin/tsx')
const result = spawnSync(tsx, ['src/migrate.ts'], {
  cwd: join(root, 'packages/db'),
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
