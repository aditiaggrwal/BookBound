import { and, eq, ilike, or, sql } from 'drizzle-orm'
import { books, enqueueEnrichment, importBatches, importRows, userBooks } from '@bookbound/db'
import type { Database } from '@bookbound/db'
import { catalogTitle, coerceCandidate, coerceParsedBook } from '@bookbound/shared'
import type { BookCandidate, ImportRowResult, ParsedBook } from '@bookbound/shared'
import { searchOpenLibrary } from '@bookbound/shared/catalog'
import { HttpError, isUniqueViolation } from '../http'
import { matchRow, resolveReviewAction } from './match'
import type { ReviewAction } from './match'

type BookRow = typeof books.$inferSelect
type ImportRow = typeof importRows.$inferSelect

function bookToCandidate(book: BookRow): BookCandidate {
  const isbns = [book.isbn13, book.isbn10].filter((isbn): isbn is string => Boolean(isbn))
  return {
    bookId: book.id,
    title: book.title,
    authors: book.authors,
    isbn13: book.isbn13,
    isbn10: book.isbn10,
    isbns,
    coverUrl: book.coverUrl,
    year: book.year,
    subjects: book.subjects,
    openLibraryKey: book.openLibraryKey,
    description: book.description,
    language: book.language,
    source: book.metadataSource === 'google-books' ? 'google-books' : book.metadataSource === 'seed' ? 'seed' : 'local',
  }
}

function dedupe(local: BookCandidate[], remote: BookCandidate[]): BookCandidate[] {
  const merged = local.map((candidate) => ({ ...candidate, isbns: [...candidate.isbns] }))
  for (const candidate of remote) {
    const twin = merged.find(
      (item) =>
        (candidate.openLibraryKey && item.openLibraryKey === candidate.openLibraryKey) ||
        candidate.isbns.some((isbn) => item.isbns.includes(isbn)),
    )
    if (twin) {
      if (!twin.coverUrl && candidate.coverUrl) twin.coverUrl = candidate.coverUrl
      if (!twin.description && candidate.description) twin.description = candidate.description
      twin.isbns = [...new Set([...twin.isbns, ...candidate.isbns])]
      continue
    }
    merged.push(candidate)
  }
  return merged
}

async function localCandidates(db: Database, row: ParsedBook): Promise<BookCandidate[]> {
  const found = new Map<string, BookRow>()
  if (row.isbn13) {
    const hits = await db.select().from(books).where(eq(books.isbn13, row.isbn13)).limit(1)
    for (const hit of hits) found.set(hit.id, hit)
  }
  if (row.isbn10) {
    const hits = await db.select().from(books).where(eq(books.isbn10, row.isbn10)).limit(1)
    for (const hit of hits) found.set(hit.id, hit)
  }
  const title = (catalogTitle(row.title) || row.title).slice(0, 48).replace(/[%_]/g, '')
  if (title.length >= 3) {
    const hits = await db.select().from(books).where(ilike(books.title, `${title}%`)).limit(12)
    for (const hit of hits) found.set(hit.id, hit)
  }
  return [...found.values()].map(bookToCandidate)
}

async function gatherCandidates(db: Database, row: ParsedBook, openLibrary: { down: boolean }): Promise<BookCandidate[]> {
  const local = await localCandidates(db, row)
  if (openLibrary.down) return local
  try {
    let remote: BookCandidate[] = []
    if (row.isbn13) remote = await searchOpenLibrary({ isbn: row.isbn13, limit: 3 })
    else if (row.isbn10) remote = await searchOpenLibrary({ isbn: row.isbn10, limit: 3 })
    if (remote.length === 0) {
      const title = catalogTitle(row.title) || row.title.trim()
      const author = row.author.replace(/\s+/g, ' ').trim()
      if (title) remote = await searchOpenLibrary({ title, author, limit: 5 })
      const relaxedAuthor = author
        .replace(/\./g, ' ')
        .split(/\s+/)
        .filter((token) => token.length > 1)
        .join(' ')
      if (remote.length === 0 && title) remote = await searchOpenLibrary({ q: `${title} ${relaxedAuthor}`.trim(), limit: 5 })
    }
    return dedupe(local, remote)
  } catch {
    openLibrary.down = true
    return local
  }
}

export async function upsertBook(db: Database, candidate: BookCandidate): Promise<string> {
  const matches: BookRow[] = []
  if (candidate.bookId) {
    matches.push(...(await db.select().from(books).where(eq(books.id, candidate.bookId)).limit(1)))
  }
  if (matches.length === 0 && candidate.isbn13) {
    matches.push(...(await db.select().from(books).where(eq(books.isbn13, candidate.isbn13)).limit(1)))
  }
  if (matches.length === 0 && candidate.openLibraryKey) {
    matches.push(...(await db.select().from(books).where(eq(books.openLibraryKey, candidate.openLibraryKey)).limit(1)))
  }
  for (const isbn of candidate.isbns) {
    if (matches.length > 0 || isbn.length !== 13) continue
    matches.push(...(await db.select().from(books).where(eq(books.isbn13, isbn)).limit(1)))
  }
  const existing = matches[0]
  if (existing) {
    await db
      .update(books)
      .set({
        coverUrl: existing.coverUrl ?? candidate.coverUrl,
        description: existing.description ?? candidate.description,
        year: existing.year ?? candidate.year,
        language: existing.language ?? candidate.language,
        openLibraryKey: existing.openLibraryKey ?? candidate.openLibraryKey,
        isbn13: existing.isbn13 ?? candidate.isbn13,
        isbn10: existing.isbn10 ?? candidate.isbn10,
        subjects: existing.subjects.length > 0 ? existing.subjects : candidate.subjects,
      })
      .where(eq(books.id, existing.id))
    return existing.id
  }
  const id = crypto.randomUUID()
  try {
    await db.insert(books).values({
      id,
      title: candidate.title,
      authors: candidate.authors.length > 0 ? candidate.authors : ['Unknown'],
      isbn13: candidate.isbn13,
      isbn10: candidate.isbn10,
      year: candidate.year,
      description: candidate.description,
      subjects: candidate.subjects,
      coverUrl: candidate.coverUrl,
      language: candidate.language,
      thin: false,
      metadataSource: candidate.source,
      openLibraryKey: candidate.openLibraryKey,
    })
    return id
  } catch (error) {
    if (!isUniqueViolation(error)) throw error
    if (candidate.isbn13) {
      const again = await db.select().from(books).where(eq(books.isbn13, candidate.isbn13)).limit(1)
      if (again[0]) return again[0].id
    }
    throw error
  }
}

export async function linkUserBook(
  db: Database,
  userId: string,
  bookId: string,
  row: Pick<ParsedBook, 'shelf' | 'rating' | 'dateRead' | 'dateAdded' | 'review'>,
  source: 'import' | 'app',
): Promise<'added' | 'changed' | 'unchanged'> {
  const load = async () => {
    const found = await db
      .select()
      .from(userBooks)
      .where(and(eq(userBooks.userId, userId), eq(userBooks.bookId, bookId)))
      .limit(1)
    return found[0] ?? null
  }
  let current = await load()
  if (!current) {
    try {
      await db.insert(userBooks).values({
        id: crypto.randomUUID(),
        userId,
        bookId,
        shelf: row.shelf,
        rating: row.rating,
        dateRead: row.dateRead,
        dateAdded: row.dateAdded,
        source,
        reviewText: row.review,
        ratingChangedInApp: false,
      })
      return 'added'
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      current = await load()
    }
  }
  if (!current) throw new Error('Could not save this book on your library.')
  const nextRating = current.ratingChangedInApp ? current.rating : (row.rating ?? current.rating)
  const nextDateRead = row.dateRead ?? current.dateRead
  const nextReview = current.reviewText ?? row.review
  const changed =
    nextRating !== current.rating ||
    row.shelf !== current.shelf ||
    nextDateRead !== current.dateRead ||
    (row.review !== null && current.reviewText === null)
  if (!changed) return 'unchanged'
  await db
    .update(userBooks)
    .set({
      rating: nextRating,
      shelf: row.shelf,
      dateRead: nextDateRead,
      dateAdded: current.dateAdded ?? row.dateAdded,
      reviewText: nextReview,
    })
    .where(eq(userBooks.id, current.id))
  return 'changed'
}

async function bump(db: Database, batchId: string, kind: 'added' | 'changed' | 'skipped' | 'received', delta: number) {
  const where = eq(importBatches.id, batchId)
  if (kind === 'added') {
    await db.update(importBatches).set({ addedCount: sql`${importBatches.addedCount} + ${delta}` }).where(where)
  } else if (kind === 'changed') {
    await db.update(importBatches).set({ changedCount: sql`${importBatches.changedCount} + ${delta}` }).where(where)
  } else if (kind === 'skipped') {
    await db.update(importBatches).set({ skippedCount: sql`${importBatches.skippedCount} + ${delta}` }).where(where)
  } else {
    await db.update(importBatches).set({ receivedCount: sql`${importBatches.receivedCount} + ${delta}` }).where(where)
  }
}

function toResult(record: ImportRow): ImportRowResult {
  const original = record.original
  return {
    rowId: record.id,
    sourceIndex: record.sourceIndex,
    status: record.status as ImportRowResult['status'],
    confidence: record.confidence,
    candidate: record.candidate,
    title: original.title,
    author: original.author,
  }
}

async function requireBatch(db: Database, userId: string, batchId: string) {
  const found = await db
    .select()
    .from(importBatches)
    .where(and(eq(importBatches.id, batchId), eq(importBatches.userId, userId)))
    .limit(1)
  const batch = found[0]
  if (!batch) throw new HttpError('That import is not available.', 404)
  return batch
}

export async function createBatch(db: Database, userId: string, totalRows: number, useReviewText: boolean) {
  if (!Number.isInteger(totalRows) || totalRows < 0 || totalRows > 20000) {
    throw new HttpError('BookBound accepts up to 20,000 books in one file.', 400)
  }
  const id = crypto.randomUUID()
  await db.insert(importBatches).values({
    id,
    userId,
    totalRows,
    useReviewText,
    status: 'open',
  })
  return id
}

export async function importRowsForBatch(db: Database, userId: string, batchId: string, rows: unknown[]) {
  const batch = await requireBatch(db, userId, batchId)
  if (!Array.isArray(rows) || rows.length > 200) {
    throw new HttpError('Send at most 200 books at a time.', 400)
  }
  const openLibrary = { down: false }
  const results: ImportRowResult[] = []
  for (const input of rows) {
    if (!input || typeof input !== 'object') continue
    const sourceIndex = (input as { sourceIndex?: unknown }).sourceIndex
    if (typeof sourceIndex !== 'number' || !Number.isInteger(sourceIndex) || sourceIndex < 0) continue
    const parsed = coerceParsedBook(input)
    if (!parsed) continue
    const existing = await db
      .select()
      .from(importRows)
      .where(and(eq(importRows.batchId, batchId), eq(importRows.sourceIndex, sourceIndex)))
      .limit(1)
    if (existing[0]) {
      results.push(toResult(existing[0]))
      continue
    }
    const stored = batch.useReviewText ? parsed : { ...parsed, review: null }
    const decision = matchRow(stored, await gatherCandidates(db, stored, openLibrary))
    let bookId: string | null = null
    let action: 'added' | 'changed' | 'unchanged' | null = null
    if (decision.status === 'auto' && decision.candidate) {
      bookId = await upsertBook(db, decision.candidate)
      action = await linkUserBook(db, userId, bookId, stored, 'import')
      await enqueueEnrichment(db, bookId)
    }
    const rowId = crypto.randomUUID()
    try {
      await db.insert(importRows).values({
        id: rowId,
        batchId,
        sourceIndex,
        original: stored,
        status: decision.status,
        confidence: decision.confidence,
        candidate: decision.candidate,
        bookId,
      })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      const raced = await db
        .select()
        .from(importRows)
        .where(and(eq(importRows.batchId, batchId), eq(importRows.sourceIndex, sourceIndex)))
        .limit(1)
      if (raced[0]) results.push(toResult(raced[0]))
      continue
    }
    if (action === 'added') await bump(db, batchId, 'added', 1)
    if (action === 'changed') await bump(db, batchId, 'changed', 1)
    if (decision.status === 'unmatched') await bump(db, batchId, 'skipped', 1)
    await bump(db, batchId, 'received', 1)
    results.push({
      rowId,
      sourceIndex,
      status: decision.status,
      confidence: decision.confidence,
      candidate: decision.candidate,
      title: stored.title,
      author: stored.author,
    })
  }
  return results
}

export async function batchSummary(db: Database, userId: string, batchId: string) {
  const batch = await requireBatch(db, userId, batchId)
  return {
    id: batch.id,
    added: batch.addedCount,
    changed: batch.changedCount,
    skipped: batch.skippedCount,
    totalRows: batch.totalRows,
    received: batch.receivedCount,
    status: batch.status as 'open' | 'complete',
  }
}

export async function reviewRows(db: Database, userId: string, batchId: string) {
  await requireBatch(db, userId, batchId)
  const rows = await db.select().from(importRows).where(eq(importRows.batchId, batchId))
  return rows
    .filter((row) => row.status === 'review' || row.status === 'unmatched')
    .sort((a, b) => a.sourceIndex - b.sourceIndex)
    .map(toResult)
}

export async function completeBatch(db: Database, userId: string, batchId: string) {
  await requireBatch(db, userId, batchId)
  await db.update(importBatches).set({ status: 'complete' }).where(eq(importBatches.id, batchId))
  return batchSummary(db, userId, batchId)
}

export async function resolveImportRow(db: Database, userId: string, rowId: string, action: ReviewAction, chosen?: unknown) {
  const found = await db.select().from(importRows).where(eq(importRows.id, rowId)).limit(1)
  const record = found[0]
  if (!record) throw new HttpError('That row is not available.', 404)
  const batch = await requireBatch(db, userId, record.batchId)
  let next: ReturnType<typeof resolveReviewAction>
  try {
    next = resolveReviewAction(record.status as ImportRowResult['status'], action)
  } catch (error) {
    throw new HttpError(error instanceof Error ? error.message : 'This row cannot be changed.', 400)
  }
  const wasUnmatched = record.status === 'unmatched'
  if (next === 'skipped') {
    await db.update(importRows).set({ status: 'skipped' }).where(eq(importRows.id, rowId))
    if (!wasUnmatched) await bump(db, batch.id, 'skipped', 1)
    return toResult({ ...record, status: 'skipped' })
  }
  const candidate = action === 'choose' ? coerceCandidate(chosen) : record.candidate
  if (!candidate) throw new HttpError('Choose a book before accepting this row.', 400)
  const bookId = await upsertBook(db, candidate)
  const stored = batch.useReviewText ? record.original : { ...record.original, review: null }
  const link = await linkUserBook(db, userId, bookId, stored, 'import')
  await enqueueEnrichment(db, bookId)
  await db.update(importRows).set({ status: next, bookId, candidate }).where(eq(importRows.id, rowId))
  if (wasUnmatched) await bump(db, batch.id, 'skipped', -1)
  if (link === 'added') await bump(db, batch.id, 'added', 1)
  if (link === 'changed') await bump(db, batch.id, 'changed', 1)
  return toResult({ ...record, status: next, bookId, candidate })
}

export async function searchCatalog(db: Database, query: string): Promise<BookCandidate[]> {
  const term = query.trim().slice(0, 200)
  if (term.length < 2) throw new HttpError('Type at least two letters to search.', 400)
  const pattern = `%${term.replace(/[%_]/g, '')}%`
  const local = await db
    .select()
    .from(books)
    .where(or(ilike(books.title, pattern), sql`${books.authors}::text ILIKE ${pattern}`))
    .limit(8)
  let remote: BookCandidate[] = []
  try {
    remote = await searchOpenLibrary({ q: term, limit: 6 })
  } catch {
    remote = []
  }
  return dedupe(local.map(bookToCandidate), remote).slice(0, 12)
}

export async function addFavorite(
  db: Database,
  userId: string,
  candidateInput: unknown,
  rating: number | null,
) {
  const candidate = coerceCandidate(candidateInput)
  if (!candidate) throw new HttpError('Choose a book from the search results.', 400)
  const bookId = await upsertBook(db, candidate)
  const action = await linkUserBook(
    db,
    userId,
    bookId,
    { shelf: 'read', rating, dateRead: null, dateAdded: new Date().toISOString().slice(0, 10), review: null },
    'app',
  )
  await enqueueEnrichment(db, bookId)
  return { bookId, action }
}
