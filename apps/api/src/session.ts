import { createHash } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { users } from '@bookbound/db'
import type { Database } from '@bookbound/db'
import { HttpError, limit } from './http'

const COOKIE = 'bb_session'

export function clientIp(c: Context): string {
  const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
  return forwarded || c.req.header('x-real-ip')?.trim() || 'unknown'
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
    // Migrate legacy plaintext tokens once, then store only the hash.
    const legacy = await db.select().from(users).where(eq(users.sessionToken, token)).limit(1)
    const legacyUser = legacy[0]
    if (legacyUser && !legacyUser.dataDeletedAt) {
      await db.update(users).set({ sessionToken: hashed }).where(eq(users.id, legacyUser.id))
      return { ...legacyUser, sessionToken: hashed }
    }
  }

  const ip = clientIp(c)
  limit(`session:ip:${ip}`, 20, 60 * 60 * 1000)
  limit('session:global', 200, 60 * 60 * 1000)

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
