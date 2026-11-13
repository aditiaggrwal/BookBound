import { handle } from 'hono/vercel'
import app from '../server'

export const config = {
  runtime: 'nodejs',
  maxDuration: 60,
}

const base = handle(app)

/**
 * Host rewrites `/api/*` onto this function. Some edge setups collapse the
 * path to `/api`; restore the browser path so Hono route matching still works.
 */
function restorePath(request: Request): Request {
  const url = new URL(request.url)
  if (url.pathname !== '/api' && url.pathname !== '/api/') return request
  const original =
    request.headers.get('x-forwarded-uri') ??
    request.headers.get('x-invoke-path') ??
    request.headers.get('x-vercel-forwarded-path')
  if (!original) return request
  const path = original.startsWith('http') ? new URL(original).pathname : original.split('?')[0]
  if (!path || path === '/api' || path === '/api/') return request
  const next = new URL(request.url)
  next.pathname = path
  return new Request(next.toString(), request)
}

const handler = (request: Request) => base(restorePath(request))

export default handler
export const GET = handler
export const POST = handler
export const PUT = handler
export const PATCH = handler
export const DELETE = handler
export const OPTIONS = handler
