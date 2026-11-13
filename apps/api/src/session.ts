import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { users } from '@bookbound/db'
import type { Database } from '@bookbound/db'
import { HttpError, limit } from './http'

const COOKIE = 'bb_session'

function isIp(value: string): boolean {
  // Basic IPv4 / IPv6 shape check; enough to reject empty garbage.
  return /^(?:\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]+$/i.test(value)
}

/**
 * Prefer platform-provided client IPs only.
 * Never trust x-real-ip / cf-connecting-ip — visitors can set those.
 * Never trust the first X-Forwarded-For hop — that value is client-controlled.
 * The last X-Forwarded-For hop is appended by the proxy.
 */
export function clientIp(c: Context): string {
  const vercel = c.req.header('x-vercel-forwarded-for')?.split(',').pop()?.trim()
  if (vercel && isIp(vercel)) return vercel
  const forwarded = c.req
    .header('x-forwarded-for')
    ?.split(',')
    .map((part) => part.trim())
    .filter(Boolean)
  const last = forwarded?.at(-1)
  if (last && isIp(last)) return last
  return 'unknown'
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function cookieSecure(c: Context): boolean {
  if (process.env.COOKIE_SECURE === 'false') return false
  if (process.env.COOKIE_SECURE === 'true') return true
  return Boolean(process.env.VERCEL) || process.env.NODE_ENV === 'production' || c.req.url.startsWith('https:')
}

export async function getUser(c: Context, db: Database) {
  const token = getCookie(c, COOKIE)
  if (token) {
    const hashed = hashToken(token)
    const existing = await db.select().from(users).where(eq(users.sessionToken, hashed)).limit(1)
    const user = existing[0]
    if (user && !user.dataDeletedAt) return user
  }

  const ip = clientIp(c)
  limit(`session:ip:${ip}`, 5, 60 * 60 * 1000)
  limit('session:global', 50, 60 * 60 * 1000)

  const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: null,
    sessionToken: hashToken(sessionToken),
    settings: {},
  })
  setCookie(c, COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: cookieSecure(c),
    maxAge: 60 * 60 * 24 * 400,
  })
  const created = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const user = created[0]
  if (!user) throw new HttpError('Could not start a session.', 500)
  return user
}
