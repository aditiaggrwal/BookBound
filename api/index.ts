export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

type App = { fetch: (request: Request) => Response | Promise<Response> }

let appPromise: Promise<App> | null = null

function loadApp(): Promise<App> {
  if (!appPromise) {
    // Built by `node scripts/bundle-api.mjs` during `pnpm build`.
    appPromise = import('./app.bundle.mjs')
      .then((mod) => (mod.default ?? mod) as App)
      .catch((error) => {
        appPromise = null
        throw error
      })
  }
  return appPromise
}

/**
 * Host rewrites `/api/:path*` to `/api?__bb_path=:path*`. Rebuild the original
 * path so Hono can match `/api/library/summary` and friends.
 */
function restorePath(request: Request): Request {
  const url = new URL(request.url)
  const fromQuery = url.searchParams.get('__bb_path')
  if (fromQuery) {
    const next = new URL(request.url)
    next.pathname = `/api/${fromQuery.replace(/^\/+/, '')}`
    next.searchParams.delete('__bb_path')
    return new Request(next.toString(), request)
  }

  if (url.pathname !== '/api' && url.pathname !== '/api/') return request

  const candidates = [
    request.headers.get('x-forwarded-uri'),
    request.headers.get('x-invoke-path'),
    request.headers.get('x-vercel-forwarded-path'),
    request.headers.get('x-matched-path'),
    request.headers.get('x-original-url'),
    request.headers.get('x-forwarded-path'),
  ]

  for (const original of candidates) {
    if (!original) continue
    let path = original
    try {
      path = original.startsWith('http') ? new URL(original).pathname : original.split('?')[0] ?? original
    } catch {
      path = original.split('?')[0] ?? original
    }
    if (!path.startsWith('/')) path = `/${path}`
    if (path === '/api' || path === '/api/') continue
    if (!path.startsWith('/api/')) path = `/api${path.startsWith('/') ? path : `/${path}`}`
    const next = new URL(request.url)
    next.pathname = path
    return new Request(next.toString(), request)
  }
  return request
}

async function handler(request: Request): Promise<Response> {
  const restored = restorePath(request)
  try {
    const path = new URL(restored.url).pathname
    if (path === '/api/ping') {
      return Response.json({ ok: true })
    }
    const app = await loadApp()
    return await app.fetch(restored)
  } catch (error) {
    console.error('API handler crash', error)
    return Response.json({ message: 'Something went wrong. Try again.' }, { status: 500 })
  }
}

export default handler
export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
