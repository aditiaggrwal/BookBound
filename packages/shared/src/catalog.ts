import { cleanIsbn } from './text'
import type { BookCandidate } from './types'

const USER_AGENT = 'BookBound/0.1 (personal reading map)'

type SearchDoc = {
  key?: string
  title?: string
  author_name?: string[]
  isbn?: string[]
  cover_i?: number
  first_publish_year?: number
  subject?: string[]
  language?: string[]
}

const cache = new Map<string, { at: number; value: BookCandidate[] }>()
const CACHE_MS = 10 * 60 * 1000

function remember(key: string, value: BookCandidate[]): BookCandidate[] {
  if (cache.size > 1000) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), value })
  return value
}

function recall(key: string): BookCandidate[] | null {
  const hit = cache.get(key)
  if (!hit) return null
  if (Date.now() - hit.at > CACHE_MS) {
    cache.delete(key)
    return null
  }
  return hit.value
}

export function chooseIsbn13(values: string[]): string | null {
  return values.find((value) => value.startsWith('9780') || value.startsWith('9781')) ?? values[0] ?? null
}

const STUDY_GUIDE_AUTHOR = /^(sparknotes|cliffsnotes|cliffs notes|bookrags|shmoop|gradesaver|litcharts|course hero)$/i

export function catalogAuthors(names: string[] | undefined): string[] {
  const cleaned = (names ?? []).map((author) => author.trim()).filter(Boolean)
  const withoutGuides = cleaned.filter((author) => !STUDY_GUIDE_AUTHOR.test(author))
  return (withoutGuides.length > 0 ? withoutGuides : cleaned).slice(0, 8)
}

export function mapSearchDoc(doc: SearchDoc): BookCandidate | null {
  if (!doc.title?.trim()) return null
  const cleaned = (doc.isbn ?? []).map((isbn) => cleanIsbn(isbn)).filter((isbn): isbn is string => Boolean(isbn))
  const isbn13s = cleaned.filter((isbn) => isbn.length === 13)
  const isbn10s = cleaned.filter((isbn) => isbn.length === 10)
  const subjects = (doc.subject ?? []).filter((subject) => !subject.toLowerCase().startsWith('nyt:')).slice(0, 12)
  return {
    bookId: null,
    title: doc.title.trim(),
    authors: catalogAuthors(doc.author_name),
    isbn13: chooseIsbn13(isbn13s),
    isbn10: isbn10s[0] ?? null,
    isbns: cleaned,
    coverUrl: typeof doc.cover_i === 'number' ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg` : null,
    year: typeof doc.first_publish_year === 'number' ? doc.first_publish_year : null,
    subjects,
    openLibraryKey: doc.key ?? null,
    description: null,
    language: doc.language?.includes('eng') ? 'eng' : (doc.language?.[0] ?? null),
    source: 'open-library',
  }
}

export function mapSearchResponse(payload: unknown): BookCandidate[] {
  if (!payload || typeof payload !== 'object' || !('docs' in payload)) return []
  const docs = (payload as { docs?: unknown }).docs
  if (!Array.isArray(docs)) return []
  return docs.flatMap((doc) => {
    if (!doc || typeof doc !== 'object') return []
    const mapped = mapSearchDoc(doc as SearchDoc)
    return mapped ? [mapped] : []
  })
}

export function readDescription(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (value && typeof value === 'object' && 'value' in value && typeof value.value === 'string') {
    return value.value.trim() || null
  }
  return null
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json', 'user-agent': USER_AGENT },
    })
    if (!response.ok) throw new Error(`Catalog request failed (${response.status})`)
    return await response.json()
  } finally {
    clearTimeout(timer)
  }
}

export async function searchOpenLibrary(params: { q?: string; title?: string; author?: string; isbn?: string; limit?: number }): Promise<BookCandidate[]> {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.title) query.set('title', params.title)
  if (params.author) query.set('author', params.author)
  if (params.isbn) query.set('isbn', params.isbn)
  query.set('limit', String(params.limit ?? 5))
  query.set('fields', 'key,title,author_name,isbn,cover_i,first_publish_year,subject,language')
  const key = query.toString()
  const cached = recall(key)
  if (cached) return cached
  const payload = await fetchJson(`https://openlibrary.org/search.json?${key}`)
  return remember(key, mapSearchResponse(payload))
}

export async function fetchOpenLibraryWork(workKey: string): Promise<{ description: string | null; subjects: string[] }> {
  const key = workKey.startsWith('/') ? workKey : `/${workKey}`
  const payload = await fetchJson(`https://openlibrary.org${key}.json`)
  if (!payload || typeof payload !== 'object') return { description: null, subjects: [] }
  const record = payload as { description?: unknown; subjects?: unknown }
  const subjects = Array.isArray(record.subjects)
    ? record.subjects
        .map((subject) => {
          if (typeof subject === 'string') return subject
          if (subject && typeof subject === 'object' && 'name' in subject && typeof subject.name === 'string') return subject.name
          return null
        })
        .filter((subject): subject is string => Boolean(subject))
        .slice(0, 20)
    : []
  return { description: readDescription(record.description), subjects }
}

export async function lookupGoogleBooks(isbn: string, apiKey: string): Promise<Pick<BookCandidate, 'description' | 'subjects' | 'coverUrl' | 'language' | 'year'> | null> {
  const url = `https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}&key=${encodeURIComponent(apiKey)}`
  const payload = await fetchJson(url)
  if (!payload || typeof payload !== 'object' || !('items' in payload) || !Array.isArray(payload.items)) return null
  const info = payload.items[0]?.volumeInfo as
    | {
        description?: string
        categories?: string[]
        imageLinks?: { thumbnail?: string }
        language?: string
        publishedDate?: string
      }
    | undefined
  if (!info) return null
  const year = Number(String(info.publishedDate ?? '').slice(0, 4))
  const thumbnail = info.imageLinks?.thumbnail?.replace(/^http:\/\//, 'https://') ?? null
  return {
    description: info.description?.trim() || null,
    subjects: info.categories ?? [],
    coverUrl: thumbnail,
    language: info.language ?? null,
    year: Number.isFinite(year) ? year : null,
  }
}
