import app from '../server'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

/**
 * Host rewrites `/api/*` onto this function. Some edge setups collapse the
 * path to `/api`; restore the browser path so Hono route matching still works.
 */
function restorePath(request: Request): Request {
  const url = new URL(request.url)
  if (url.pathname !== '/api' && url.pathname !== '/api/') return request

  const candidates = [
    request.headers.get('x-forwarded-uri'),
    request.headers.get('x-invoke-path'),
    request.headers.get('x-vercel-forwarded-path'),
    request.headers.get('x-matched-path'),
    request.headers.get('x-rewrite-url'),
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
    // Some hosts forward the suffix without the /api prefix.
    if (!path.startsWith('/api/') && path.startsWith('/import/')) path = `/api${path}`
    const next = new URL(request.url)
    next.pathname = path
    return new Request(next.toString(), request)
  }
  return request
}

function sanitize(error: unknown): string {
  const raw = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
  return raw
    .replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[db-url]')
    .replace(/password=[^\s&]+/gi, 'password=[redacted]')
    .slice(0, 180)
}

async function handler(request: Request): Promise<Response> {
  try {
    return await app.fetch(restorePath(request))
  } catch (error) {
    console.error('API handler crash', error)
    return Response.json(
      {
        message: 'Something went wrong. Try again.',
        detail: sanitize(error),
      },
      { status: 500 },
    )
  }
}

export default handler
export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
