export const SHELVES = ['read', 'to-read', 'reading', 'did-not-finish'] as const
export type Shelf = (typeof SHELVES)[number]

export const TAG_AXES = ['atmosphere', 'style', 'idea'] as const
export type TagAxis = (typeof TAG_AXES)[number]

export const EMBEDDING_AXES = ['atmosphere', 'style', 'idea', 'combined'] as const
export type EmbeddingAxis = (typeof EMBEDDING_AXES)[number]

export const ROW_STATUSES = ['auto', 'review', 'unmatched', 'accepted', 'skipped', 'chosen'] as const
export type RowStatus = (typeof ROW_STATUSES)[number]

export type ParsedBook = {
  title: string
  author: string
  authors: string[]
  isbn10: string | null
  isbn13: string | null
  rating: number | null
  averageRating: number | null
  dateRead: string | null
  dateAdded: string | null
  bookshelves: string[]
  shelf: Shelf
  review: string | null
}

export type BookCandidate = {
  bookId: string | null
  title: string
  authors: string[]
  isbn13: string | null
  isbn10: string | null
  isbns: string[]
  coverUrl: string | null
  year: number | null
  subjects: string[]
  openLibraryKey: string | null
  description: string | null
  language: string | null
  source: 'open-library' | 'google-books' | 'local' | 'seed'
}

export type TagPhrase = {
  phrase: string
  confidence: number
  evidence: string
}

export type TagSets = Record<TagAxis, TagPhrase[]>

export type ImportRowResult = {
  rowId: string
  sourceIndex: number
  status: RowStatus
  confidence: number
  candidate: BookCandidate | null
  title: string
  author: string
}

export type BatchSummary = {
  id: string
  added: number
  changed: number
  skipped: number
  totalRows: number
  received: number
  status: 'open' | 'complete'
}

export type LibrarySummary = {
  total: number
  ratedCount: number
  early: boolean
}

const SHELF_SET = new Set<string>(SHELVES)

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.slice(0, max)
}

function nullableText(value: unknown, max: number): string | null {
  return text(value, max)
}

function numberOrNull(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  if (value < min || value > max) return null
  return value
}

export function coerceParsedBook(input: unknown): ParsedBook | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Record<string, unknown>
  const title = text(row.title, 300)
  const author = text(row.author, 300)
  if (!title || !author) return null
  const authors = Array.isArray(row.authors)
    ? row.authors
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean)
        .slice(0, 8)
    : [author]
  const shelf = typeof row.shelf === 'string' && SHELF_SET.has(row.shelf) ? (row.shelf as Shelf) : 'to-read'
  const isbn13 = typeof row.isbn13 === 'string' ? row.isbn13 : null
  const isbn10 = typeof row.isbn10 === 'string' ? row.isbn10 : null
  return {
    title,
    author,
    authors: authors.length > 0 ? authors : [author],
    isbn10: isbn10 && isbn10.length === 10 ? isbn10 : null,
    isbn13: isbn13 && isbn13.length === 13 ? isbn13 : null,
    rating: numberOrNull(row.rating, 0.5, 5),
    averageRating: numberOrNull(row.averageRating, 0, 5),
    dateRead: dateOrNull(row.dateRead),
    dateAdded: dateOrNull(row.dateAdded),
    bookshelves: Array.isArray(row.bookshelves)
      ? row.bookshelves.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : [],
    shelf,
    review: nullableText(row.review, 10000),
  }
}

function dateOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null
}

export function coerceCandidate(input: unknown): BookCandidate | null {
  if (!input || typeof input !== 'object') return null
  const row = input as Record<string, unknown>
  const title = text(row.title, 300)
  if (!title) return null
  const authors = Array.isArray(row.authors)
    ? row.authors.filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean).slice(0, 8)
    : []
  const isbns = Array.isArray(row.isbns)
    ? row.isbns.filter((item): item is string => typeof item === 'string').slice(0, 40)
    : []
  const source = row.source
  const allowed = new Set(['open-library', 'google-books', 'local', 'seed'])
  return {
    bookId: typeof row.bookId === 'string' ? row.bookId : null,
    title,
    authors,
    isbn13: typeof row.isbn13 === 'string' ? row.isbn13 : null,
    isbn10: typeof row.isbn10 === 'string' ? row.isbn10 : null,
    isbns,
    coverUrl: typeof row.coverUrl === 'string' ? row.coverUrl.slice(0, 500) : null,
    year: numberOrNull(row.year, 0, 3000),
    subjects: Array.isArray(row.subjects)
      ? row.subjects.filter((item): item is string => typeof item === 'string').slice(0, 20)
      : [],
    openLibraryKey: typeof row.openLibraryKey === 'string' ? row.openLibraryKey.slice(0, 200) : null,
    description: typeof row.description === 'string' ? row.description.slice(0, 20000) : null,
    language: typeof row.language === 'string' ? row.language.slice(0, 16) : null,
    source: typeof source === 'string' && allowed.has(source) ? (source as BookCandidate['source']) : 'open-library',
  }
}
