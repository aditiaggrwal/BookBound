import { and, eq, inArray } from 'drizzle-orm'
import { enrichmentJobs } from './schema'
import type { Database } from './client'

export async function enqueueEnrichment(db: Database, bookId: string): Promise<void> {
  const existing = await db
    .select({ id: enrichmentJobs.id })
    .from(enrichmentJobs)
    .where(and(eq(enrichmentJobs.bookId, bookId), inArray(enrichmentJobs.status, ['pending', 'running', 'done'])))
    .limit(1)
  if (existing.length > 0) return
  await db.insert(enrichmentJobs).values({
    id: crypto.randomUUID(),
    bookId,
    status: 'pending',
  })
}
