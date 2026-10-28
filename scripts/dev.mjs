import { spawn } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const children = [
  {
    name: 'api',
    command: join(root, 'apps/api/node_modules/.bin/tsx'),
    args: ['watch', 'src/index.ts'],
    cwd: join(root, 'apps/api'),
  },
  {
    name: 'worker',
    command: join(root, 'apps/worker/node_modules/.bin/tsx'),
    args: ['watch', 'src/index.ts'],
    cwd: join(root, 'apps/worker'),
  },
  {
    name: 'web',
    command: join(root, 'apps/web/node_modules/.bin/vite'),
    args: ['--host', '127.0.0.1', '--port', '5173'],
    cwd: join(root, 'apps/web'),
  },
]

const running = children.map((child) => {
  const proc = spawn(child.command, child.args, { cwd: child.cwd, stdio: 'inherit' })
  proc.on('exit', (code) => {
    if (code && code !== 0) {
      console.error(`${child.name} exited with ${code}`)
      shutdown()
    }
  })
  return proc
})

function shutdown() {
  for (const proc of running) proc.kill('SIGTERM')
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
