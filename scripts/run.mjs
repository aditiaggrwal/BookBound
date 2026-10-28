import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const task = process.argv[2]
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packages = ['packages/shared', 'packages/db', 'apps/api', 'apps/worker', 'apps/web']

if (task !== 'test' && task !== 'typecheck') {
  console.error('Use test or typecheck.')
  process.exit(1)
}

let failed = false
for (const pkg of packages) {
  const cwd = join(root, pkg)
  const bin = join(cwd, task === 'test' ? 'node_modules/.bin/vitest' : 'node_modules/.bin/tsc')
  if (!existsSync(bin)) continue
  const args = task === 'test' ? ['run'] : ['--noEmit']
  const result = spawnSync(bin, args, { cwd, stdio: 'inherit' })
  if (result.status !== 0) failed = true
}

process.exit(failed ? 1 : 0)
