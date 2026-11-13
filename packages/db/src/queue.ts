import { and, count, eq, inArray } from 'drizzle-orm'
import { enrichmentJobs } from './schema'
import type { Database } from './client'

const MAX_PENDING = 100

export async function enqueueEnrichment(db: Database, bookId: string): Promise<void> {
  const existing = await db
    .select({ id: enrichmentJobs.id })
    .from(enrichmentJobs)
    .where(and(eq(enrichmentJobs.bookId, bookId), inArray(enrichmentJobs.status, ['pending', 'running', 'done'])))
    .limit(1)
  if (existing.length > 0) return

  const [pending] = await db
    .select({ total: count() })
    .from(enrichmentJobs)
    .where(inArray(enrichmentJobs.status, ['pending', 'running']))
  if ((pending?.total ?? 0) >= MAX_PENDING) return

  await db.insert(enrichmentJobs).values({
    id: crypto.randomUUID(),
    bookId,
    status: 'pending',
  })
}
