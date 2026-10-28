import { eq } from 'drizzle-orm'
import { getCookie, setCookie } from 'hono/cookie'
import type { Context } from 'hono'
import { users } from '@bookbound/db'
import type { Database } from '@bookbound/db'

const COOKIE = 'bb_session'

export async function getUser(c: Context, db: Database) {
  const token = getCookie(c, COOKIE)
  if (token) {
    const existing = await db.select().from(users).where(eq(users.sessionToken, token)).limit(1)
    const user = existing[0]
    if (user && !user.dataDeletedAt) return user
  }
  const sessionToken = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '')
  const id = crypto.randomUUID()
  await db.insert(users).values({
    id,
    email: null,
    sessionToken,
    settings: {},
  })
  setCookie(c, COOKIE, sessionToken, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 60 * 60 * 24 * 400,
  })
  const created = await db.select().from(users).where(eq(users.id, id)).limit(1)
  const user = created[0]
  if (!user) throw new Error('Could not start a session.')
  return user
}
