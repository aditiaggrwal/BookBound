import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { and, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { bookTags, books, enrichmentJobs, enqueueEnrichment, tagReviews, userBooks } from '@bookbound/db'
import type { Database } from '@bookbound/db'
import type { TagAxis } from '@bookbound/shared'
import { HttpError } from '../http'
import { upsertBook } from '../import/service'

export type SeedBook = { isbn13: string; title: string; author: string }

export function readSeed(): SeedBook[] {
  const path = fileURLToPath(new URL('../../../../data/review-isbns.json', import.meta.url))
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SeedBook[]
  return parsed
}

export async function librarySummary(db: Database, userId: string) {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      ratedCount: sql<number>`count(*) filter (where ${userBooks.shelf} = 'read' and ${userBooks.rating} is not null and ${userBooks.rating} > 0)::int`,
    })
    .from(userBooks)
    .where(eq(userBooks.userId, userId))
  const total = row?.total ?? 0
  const ratedCount = row?.ratedCount ?? 0
  return { total, ratedCount, early: ratedCount < 15 }
}

export async function listLibrary(db: Database, userId: string, offset: number, limit: number) {
  const rows = await db.select().from(userBooks).where(eq(userBooks.userId, userId))
  const ordered = [...rows].sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? '') || a.createdAt.getTime() - b.createdAt.getTime())
  const page = ordered.slice(offset, offset + limit)
  const ids = page.map((row) => row.bookId)
  if (ids.length === 0) return { books: [], total: rows.length }
  const bookRows = await db.select().from(books).where(inArray(books.id, ids))
  const tags = await db
    .select()
    .from(bookTags)
    .where(and(inArray(bookTags.bookId, ids), or(isNull(bookTags.userId), eq(bookTags.userId, userId))))
  const jobs = await db.select().from(enrichmentJobs).where(inArray(enrichmentJobs.bookId, ids))
  const byBook = new Map(bookRows.map((book) => [book.id, book]))
  return {
    total: rows.length,
    books: page.flatMap((entry) => {
      const book = byBook.get(entry.bookId)
      if (!book) return []
      const bookJobs = jobs.filter((job) => job.bookId === book.id)
      const pending = bookJobs.some((job) => job.status === 'pending' || job.status === 'running')
      const latest = [...bookJobs].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0]
      const phrases = tags.filter((tag) => tag.bookId === book.id && tag.usable)
      const grouped: Record<TagAxis, string[]> = { atmosphere: [], style: [], idea: [] }
      for (const tag of phrases) {
        if (tag.axis === 'atmosphere' || tag.axis === 'style' || tag.axis === 'idea') grouped[tag.axis].push(tag.phrase)
      }
      const enrichment = book.thin ? 'thin' : pending ? 'tagging' : latest?.status === 'failed' ? 'failed' : 'ready'
      return [
        {
          userBookId: entry.id,
          bookId: book.id,
          title: book.title,
          authors: book.authors,
          coverUrl: book.coverUrl,
          shelf: entry.shelf,
          rating: entry.rating,
          source: entry.source,
          enrichment,
          tags: grouped,
        },
      ]
    }),
  }
}

export async function setRating(db: Database, userId: string, userBookId: string, rating: number | null) {
  const found = await db
    .select()
    .from(userBooks)
    .where(and(eq(userBooks.id, userBookId), eq(userBooks.userId, userId)))
    .limit(1)
  if (!found[0]) throw new HttpError('That book is not in your library.', 404)
  await db.update(userBooks).set({ rating, ratingChangedInApp: true }).where(eq(userBooks.id, userBookId))
}

export async function retryTagging(db: Database, userId: string, bookId: string) {
  const owned = await db
    .select({ id: userBooks.id })
    .from(userBooks)
    .where(and(eq(userBooks.userId, userId), eq(userBooks.bookId, bookId)))
    .limit(1)
  if (!owned[0]) throw new HttpError('That book is not in your library.', 404)
  await db
    .update(enrichmentJobs)
    .set({ status: 'failed', finishedAt: new Date(), error: 'Superseded by a retry.' })
    .where(and(eq(enrichmentJobs.bookId, bookId), inArray(enrichmentJobs.status, ['pending', 'running', 'failed', 'done'])))
  await enqueueEnrichment(db, bookId)
}

export async function loadReviewSeed(db: Database) {
  const seed = readSeed()
  let created = 0
  let queued = 0
  for (const item of seed) {
    const existing = await db.select().from(books).where(eq(books.isbn13, item.isbn13)).limit(1)
    let bookId = existing[0]?.id
    if (!bookId) {
      bookId = await upsertBook(db, {
        bookId: null,
        title: item.title,
        authors: [item.author],
        isbn13: item.isbn13,
        isbn10: null,
        isbns: [item.isbn13],
        coverUrl: null,
        year: null,
        subjects: [],
        openLibraryKey: null,
        description: null,
        language: null,
        source: 'seed',
      })
      created += 1
    }
    const before = await db
      .select({ id: enrichmentJobs.id })
      .from(enrichmentJobs)
      .where(and(eq(enrichmentJobs.bookId, bookId), inArray(enrichmentJobs.status, ['pending', 'running', 'done'])))
      .limit(1)
    await enqueueEnrichment(db, bookId)
    if (before.length === 0) queued += 1
  }
  return { seed: seed.length, created, queued }
}

export async function reviewSet(db: Database) {
  const seed = readSeed()
  const isbns = seed.map((item) => item.isbn13)
  const bookRows = isbns.length === 0 ? [] : await db.select().from(books).where(inArray(books.isbn13, isbns))
  const ids = bookRows.map((book) => book.id)
  const tags = ids.length === 0 ? [] : await db.select().from(bookTags).where(and(inArray(bookTags.bookId, ids), isNull(bookTags.userId)))
  const jobs = ids.length === 0 ? [] : await db.select().from(enrichmentJobs).where(inArray(enrichmentJobs.bookId, ids))
  const judgments = ids.length === 0 ? [] : await db.select().from(tagReviews).where(inArray(tagReviews.bookId, ids))
  const [statsRow] = await db
    .select({
      judged: sql<number>`count(*)::int`,
      accurate: sql<number>`count(*) filter (where ${tagReviews.accurate})::int`,
    })
    .from(tagReviews)
  const judged = statsRow?.judged ?? 0
  const accurate = statsRow?.accurate ?? 0
  const percent = judged === 0 ? null : Math.round((accurate / judged) * 1000) / 10
  const booksOut = seed.map((item) => {
    const book = bookRows.find((row) => row.isbn13 === item.isbn13)
    if (!book) return { ...item, bookId: null, status: 'missing' as const, tags: [], accurate: null, description: null, subjects: [] as string[] }
    const bookJobs = jobs.filter((job) => job.bookId === book.id)
    const pending = bookJobs.some((job) => job.status === 'pending' || job.status === 'running')
    const failed = bookJobs.some((job) => job.status === 'failed')
    const judgment = judgments.find((itemJudgment) => itemJudgment.bookId === book.id)
    return {
      ...item,
      bookId: book.id,
      description: book.description,
      subjects: book.subjects,
      status: book.thin ? ('thin' as const) : pending ? ('tagging' as const) : failed && tags.every((tag) => tag.bookId !== book.id) ? ('failed' as const) : ('ready' as const),
      accurate: judgment ? judgment.accurate : null,
      tags: tags
        .filter((tag) => tag.bookId === book.id)
        .map((tag) => ({
          axis: tag.axis,
          phrase: tag.phrase,
          confidence: tag.confidence,
          evidence: tag.evidence,
          usable: tag.usable,
        })),
    }
  })
  return {
    stats: {
      judged,
      accurate,
      percent,
      targetBooks: 200,
      targetPercent: 85,
      gatePassed: judged >= 200 && accurate / judged >= 0.85,
      seedSize: seed.length,
    },
    books: booksOut,
  }
}

export async function judgeTags(db: Database, userId: string, bookId: string, accurate: boolean) {
  const found = await db.select().from(books).where(eq(books.id, bookId)).limit(1)
  if (!found[0]) throw new HttpError('That book is not in the review set.', 404)
  const existing = await db.select().from(tagReviews).where(eq(tagReviews.bookId, bookId)).limit(1)
  if (existing[0]) {
    await db.update(tagReviews).set({ accurate, userId }).where(eq(tagReviews.bookId, bookId))
    return
  }
  await db.insert(tagReviews).values({
    id: crypto.randomUUID(),
    bookId,
    userId,
    accurate,
  })
}
