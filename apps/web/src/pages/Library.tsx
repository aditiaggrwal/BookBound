import { useEffect, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import type { BatchSummary, TagAxis } from '@bookbound/shared'
import { Button, Card, Cover, Notice, SkeletonRows } from '../components/ui'
import { api, ApiError } from '../lib/api'

type LibraryBook = {
  userBookId: string
  bookId: string
  title: string
  authors: string[]
  coverUrl: string | null
  shelf: string
  rating: number | null
  source: string
  enrichment: 'thin' | 'tagging' | 'failed' | 'ready'
  tags: Record<TagAxis, string[]>
}

const shelfLabel: Record<string, string> = {
  read: 'Read',
  'to-read': 'To read',
  reading: 'Reading',
  'did-not-finish': 'Did not finish',
}

export function LibraryPage() {
  const [params] = useSearchParams()
  const location = useLocation()
  const note = (location.state as { note?: string } | null)?.note
  const batchId = params.get('batch')
  const [books, setBooks] = useState<LibraryBook[] | null>(null)
  const [total, setTotal] = useState(0)
  const [ratedCount, setRatedCount] = useState(0)
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [offset, setOffset] = useState(0)

  async function load(nextOffset: number, replace: boolean) {
    const [page, librarySummary, batch] = await Promise.all([
      api<{ books: LibraryBook[]; total: number }>(`/api/library?offset=${nextOffset}&limit=100`),
      api<{ ratedCount: number }>('/api/library/summary'),
      batchId ? api<BatchSummary>(`/api/import/batches/${batchId}`) : Promise.resolve(null),
    ])
    setBooks((current) => (replace || !current ? page.books : [...current, ...page.books]))
    setTotal(page.total)
    setRatedCount(librarySummary.ratedCount)
    setSummary(batch)
    setOffset(nextOffset + page.books.length)
  }

  useEffect(() => {
    void load(0, true).catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Your library could not be loaded.'))
  }, [batchId])

  const tagging = books?.some((book) => book.enrichment === 'tagging') ?? false
  useEffect(() => {
    if (!tagging) return
    const timer = window.setInterval(() => {
      void load(0, true).catch(() => undefined)
    }, 3000)
    return () => window.clearInterval(timer)
  }, [tagging, batchId])

  async function changeRating(book: LibraryBook, rating: number | null) {
    setError(null)
    try {
      await api(`/api/library/${book.userBookId}`, { method: 'PATCH', body: JSON.stringify({ rating }) })
      setBooks((current) => current?.map((item) => (item.userBookId === book.userBookId ? { ...item, rating } : item)) ?? null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The rating was not saved.')
    }
  }

  async function retry(book: LibraryBook) {
    setError(null)
    try {
      await api(`/api/library/${book.bookId}/retry`, { method: 'POST' })
      setBooks((current) => current?.map((item) => (item.bookId === book.bookId ? { ...item, enrichment: 'tagging' } : item)) ?? null)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Tagging could not be restarted.')
    }
  }

  return (
    <div>
      <h1 className="font-serif text-4xl">Your library</h1>
      <p className="mt-3 max-w-2xl text-muted">The map comes after tags are trustworthy. This list is your library so far.</p>
      {books && books.length > 0 && ratedCount < 15 ? (
        <p className="mt-4 font-serif text-lg italic text-amber">Early library: it grows as you read.</p>
      ) : null}
      {summary ? (
        <p className="mt-3 text-sm text-muted">
          Added {summary.added}. Updated {summary.changed}. Skipped {summary.skipped}.
        </p>
      ) : null}
      {note ? <p className="mt-3 text-sm text-muted">{note}</p> : null}
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {books === null ? <div className="mt-6"><SkeletonRows /></div> : null}
      {books && books.length === 0 ? (
        <Card className="mt-6">
          <p>Nothing here yet. Upload a Goodreads export, or start from three books you love.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/import" className="inline-flex min-h-11 items-center rounded-full bg-amber px-5 text-sm font-medium text-ink no-underline">
              Upload an export
            </Link>
            <Link to="/import/favorites?from=cold" className="inline-flex min-h-11 items-center text-sm text-muted no-underline">
              Start from three books
            </Link>
          </div>
        </Card>
      ) : null}
      <ul className="mt-6 space-y-3">
        {books?.map((book) => (
          <li key={book.userBookId}>
            <Card>
              <div className="flex gap-4">
                <Cover url={book.coverUrl} title={book.title} />
                <div className="min-w-0 flex-1">
                  <h2 className="font-serif text-2xl">{book.title}</h2>
                  <p className="text-sm text-muted">{book.authors.join(', ')}</p>
                  <p className="mt-1 text-sm text-muted">{shelfLabel[book.shelf] ?? book.shelf}</p>
                  <label className="mt-3 flex items-center gap-2 text-sm text-muted">
                    Your rating
                    <select
                      value={book.rating ?? ''}
                      onChange={(event) => void changeRating(book, event.target.value ? Number(event.target.value) : null)}
                      className="min-h-10 rounded-full border border-line bg-raised px-3 text-cream"
                    >
                      <option value="">Unrated</option>
                      {[5, 4, 3, 2, 1].map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  </label>
                  <TagLine book={book} onRetry={() => void retry(book)} />
                </div>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {books && offset < total ? (
        <div className="mt-6">
          <Button tone="quiet" onClick={() => void load(offset, false).catch((caught) => setError(caught instanceof ApiError ? caught.message : 'More books could not be loaded.'))}>
            Show more
          </Button>
        </div>
      ) : null}
    </div>
  )
}

function TagLine({ book, onRetry }: { book: LibraryBook; onRetry: () => void }) {
  if (book.enrichment === 'tagging') return <p className="mt-3 text-sm text-amber">Tagging…</p>
  if (book.enrichment === 'thin') return <p className="mt-3 text-sm text-muted">Not enough published text to tag this book yet.</p>
  if (book.enrichment === 'failed') {
    return (
      <div className="mt-3 flex items-center gap-3">
        <p className="text-sm text-muted">Tagging did not finish.</p>
        <Button tone="quiet" onClick={onRetry}>
          Retry tagging
        </Button>
      </div>
    )
  }
  const chips = [...book.tags.atmosphere, ...book.tags.style, ...book.tags.idea]
  if (chips.length === 0) return <p className="mt-3 text-sm text-muted">Tags will appear here when they are ready.</p>
  return (
    <ul className="mt-3 flex flex-wrap gap-2">
      {chips.map((phrase) => (
        <li key={phrase} className="rounded-full border border-line px-3 py-1 text-xs text-muted">
          {phrase}
        </li>
      ))}
    </ul>
  )
}
