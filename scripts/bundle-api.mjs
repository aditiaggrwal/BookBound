import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(join(root, 'package.json'))

/** @type {typeof import('esbuild')} */
const esbuild = require('esbuild')

await esbuild.build({
  absWorkingDir: root,
  entryPoints: [join(root, 'server.ts')],
  outfile: join(root, 'api/app.bundle.mjs'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: false,
  logLevel: 'info',
  // Provide CJS `require` so dependencies like `pg` can load Node builtins.
  banner: {
    js: "import { createRequire as __bookboundCreateRequire } from 'node:module'; const require = __bookboundCreateRequire(import.meta.url);",
  },
  alias: {
    // Hosted bundle must never pull the local PGlite entry.
    '@bookbound/db/local': join(root, 'packages/db/src/hostedStub.ts'),
  },
  external: ['@electric-sql/pglite', '@electric-sql/pglite/*'],
})

console.log('bundle-api: wrote api/app.bundle.mjs')
