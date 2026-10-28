import Papa from 'papaparse'
import { cleanIsbn, normalizeAuthor, normalizeTitle } from '@bookbound/shared'
import type { ParsedBook, Shelf } from '@bookbound/shared'

export const MAX_BYTES = 10 * 1024 * 1024
export const MAX_ROWS = 20_000

export const WRONG_FILE_MESSAGE =
  "That file isn't a Goodreads library export. On Goodreads, open My Books, then Import and export, then Export Library. Upload that CSV."

export const TOO_LARGE_MESSAGE =
  'This file is larger than 10 MB. Export your Goodreads library again, or split the CSV, and upload a file under 10 MB.'

export const TOO_MANY_ROWS_MESSAGE = 'This export has more than 20,000 rows. BookBound accepts up to 20,000 books in one file.'

export class ImportFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImportFileError'
  }
}

export type ParseResult = {
  books: ParsedBook[]
  droppedBlank: number
  collapsedDuplicates: number
}

const SHELF_RANK: Record<Shelf, number> = {
  read: 4,
  reading: 3,
  'did-not-finish': 2,
  'to-read': 1,
}

export function assertImportFile(file: { name: string; size: number }): void {
  if (file.size > MAX_BYTES) throw new ImportFileError(TOO_LARGE_MESSAGE)
  if (!file.name.toLowerCase().endsWith('.csv')) throw new ImportFileError(WRONG_FILE_MESSAGE)
}

export function parseGoodreadsCsv(text: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\uFEFF/, ''), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim().toLowerCase(),
  })
  const fields = parsed.meta.fields ?? []
  if (!fields.includes('title') || !fields.includes('author')) throw new ImportFileError(WRONG_FILE_MESSAGE)
  if (parsed.data.length > MAX_ROWS) throw new ImportFileError(TOO_MANY_ROWS_MESSAGE)

  let droppedBlank = 0
  const books: ParsedBook[] = []
  for (const record of parsed.data) {
    const book = rowToBook(record)
    if (!book) {
      droppedBlank += 1
      continue
    }
    books.push(book)
  }

  const collapsed = collapseEditions(books)
  return {
    books: collapsed.books,
    droppedBlank,
    collapsedDuplicates: collapsed.collapsed,
  }
}

function rowToBook(record: Record<string, string>): ParsedBook | null {
  const title = record.title?.trim() ?? ''
  const author = record.author?.trim() ?? ''
  if (!title || !author) return null
  const additional = splitList(record['additional authors'])
  const authors = [author, ...additional.filter((name) => name.toLowerCase() !== author.toLowerCase())]
  const bookshelves = splitList(record.bookshelves)
  return {
    title,
    author,
    authors,
    isbn10: cleanIsbn(record.isbn),
    isbn13: cleanIsbn(record.isbn13),
    rating: parseRating(record['my rating']),
    averageRating: parseAverage(record['average rating']),
    dateRead: parseDate(record['date read']),
    dateAdded: parseDate(record['date added']),
    bookshelves,
    shelf: parseShelf(record['exclusive shelf'] ?? '', bookshelves),
    review: record['my review']?.trim() || null,
  }
}

function splitList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseRating(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0 || value > 5) return null
  return value
}

function parseAverage(raw: string | undefined): number | null {
  if (!raw?.trim()) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || value > 5) return null
  return value
}

function parseDate(raw: string | undefined): string | null {
  if (!raw?.trim()) return null
  const match = raw.trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})/)
  if (!match) return null
  return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`
}

function parseShelf(exclusive: string, shelves: string[]): Shelf {
  const custom = shelves.map((shelf) => shelf.toLowerCase())
  if (custom.some((name) => name === 'dnf' || name.includes('did-not-finish') || name.includes('did not finish'))) {
    return 'did-not-finish'
  }
  const shelf = exclusive.toLowerCase().trim()
  if (shelf === 'currently-reading' || shelf === 'reading') return 'reading'
  if (shelf === 'read') return 'read'
  if (shelf === 'to-read') return 'to-read'
  return 'to-read'
}

function editionKey(book: ParsedBook): string {
  if (book.isbn13) return `isbn13:${book.isbn13}`
  if (book.isbn10) return `isbn10:${book.isbn10}`
  return `title:${normalizeTitle(book.title)}|${normalizeAuthor(book.author)}`
}

function collapseEditions(books: ParsedBook[]): { books: ParsedBook[]; collapsed: number } {
  const order: string[] = []
  const grouped = new Map<string, ParsedBook>()
  let collapsed = 0
  for (const book of books) {
    const key = editionKey(book)
    const current = grouped.get(key)
    if (!current) {
      order.push(key)
      grouped.set(key, book)
      continue
    }
    collapsed += 1
    grouped.set(key, mergeBooks(current, book))
  }
  return { books: order.map((key) => grouped.get(key)).filter((book): book is ParsedBook => Boolean(book)), collapsed }
}

function mergeBooks(current: ParsedBook, next: ParsedBook): ParsedBook {
  const rating = higherRating(current.rating, next.rating)
  const preferred = (current.rating ?? -1) >= (next.rating ?? -1) ? current : next
  const shelf = SHELF_RANK[current.shelf] >= SHELF_RANK[next.shelf] ? current.shelf : next.shelf
  const review = (current.review?.length ?? 0) >= (next.review?.length ?? 0) ? current.review : next.review
  return {
    ...preferred,
    rating,
    shelf,
    review,
    authors: [...new Set([...current.authors, ...next.authors])],
    bookshelves: [...new Set([...current.bookshelves, ...next.bookshelves])],
    dateAdded: earlierDate(current.dateAdded, next.dateAdded),
    dateRead: laterDate(current.dateRead, next.dateRead),
    averageRating: current.averageRating ?? next.averageRating,
    isbn13: current.isbn13 ?? next.isbn13,
    isbn10: current.isbn10 ?? next.isbn10,
  }
}

function higherRating(left: number | null, right: number | null): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.max(left, right)
}

function earlierDate(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return left < right ? left : right
}

function laterDate(left: string | null, right: string | null): string | null {
  if (!left) return right
  if (!right) return left
  return left > right ? left : right
}
