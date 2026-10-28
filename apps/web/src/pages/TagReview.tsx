import { useEffect, useRef, useState } from 'react'
import { Button, Card, Notice, SkeletonRows } from '../components/ui'
import { api, ApiError } from '../lib/api'

type ReviewTag = {
  axis: string
  phrase: string
  confidence: number
  evidence: string
  usable: boolean
}

type ReviewBook = {
  isbn13: string
  title: string
  author: string
  bookId: string | null
  description: string | null
  subjects: string[]
  status: 'missing' | 'thin' | 'tagging' | 'failed' | 'ready'
  accurate: boolean | null
  tags: ReviewTag[]
}

type ReviewPayload = {
  stats: {
    judged: number
    accurate: number
    percent: number | null
    targetBooks: number
    targetPercent: number
    gatePassed: boolean
    seedSize: number
  }
  books: ReviewBook[]
}

export function TagReviewPage() {
  const [payload, setPayload] = useState<ReviewPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingSeed, setLoadingSeed] = useState(false)
  const loadSeq = useRef(0)

  async function load() {
    const seq = ++loadSeq.current
    const next = await api<ReviewPayload>('/api/review/tags')
    if (seq !== loadSeq.current) return
    setPayload(next)
  }

  useEffect(() => {
    void load().catch((caught) => setError(caught instanceof ApiError ? caught.message : 'The review set could not be loaded.'))
  }, [])

  const tagging = payload?.books.some((book) => book.status === 'tagging') ?? false
  useEffect(() => {
    if (!tagging) return
    const timer = window.setInterval(() => {
      void load().catch(() => undefined)
    }, 4000)
    return () => window.clearInterval(timer)
  }, [tagging])

  async function seed() {
    setLoadingSeed(true)
    setError(null)
    try {
      await api('/api/review/seed', { method: 'POST' })
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The review set could not be queued.')
    } finally {
      setLoadingSeed(false)
    }
  }

  async function judge(bookId: string, accurate: boolean) {
    setError(null)
    try {
      await api('/api/review/tags', { method: 'POST', body: JSON.stringify({ bookId, accurate }) })
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That judgment was not saved.')
    }
  }

  if (!payload) return error ? <Notice tone="error">{error}</Notice> : <SkeletonRows />
  const { stats } = payload
  const loaded = payload.books.some((book) => book.bookId)

  return (
    <div>
      <h1 className="font-serif text-4xl">Tag review</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Accurate and Not accurate save as soon as you click them. This starter list has {stats.seedSize} books. The gate needs {stats.targetBooks} books judged, with at least {stats.targetPercent}% marked accurate.
      </p>
      <Card className="mt-6">
        <p className="font-serif text-2xl">
          {stats.judged} judged{stats.percent === null ? '' : `, ${stats.percent}% accurate`}
        </p>
        <p className="mt-2 text-sm text-muted">
          {stats.gatePassed ? 'The tag gate is passed.' : 'The gate is still open. These marks are already saved.'}
        </p>
        <div className="mt-4">
          <Button onClick={() => void seed()} disabled={loadingSeed}>
            {loaded ? 'Queue unfinished seed books' : 'Load the review set'}
          </Button>
        </div>
      </Card>
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {!loaded ? (
        <p className="mt-6 text-muted">The review set has not been loaded yet.</p>
      ) : (
        <ul className="mt-6 space-y-4">
          {payload.books.map((book) => (
            <li key={book.isbn13}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="font-serif text-2xl">{book.title}</h2>
                    <p className="text-sm text-muted">{book.author}</p>
                  </div>
                  <p className="text-sm text-amber">{statusLabel(book)}</p>
                </div>
                {book.description ? <p className="mt-4 text-sm leading-relaxed text-muted">{book.description}</p> : null}
                {book.subjects.length > 0 ? <p className="mt-3 text-xs text-muted">Subjects: {book.subjects.join(', ')}</p> : null}
                <div className="mt-4 space-y-3">
                  {(['atmosphere', 'style', 'idea'] as const).map((axis) => {
                    const tags = book.tags.filter((tag) => tag.axis === axis)
                    if (tags.length === 0) return null
                    return (
                      <div key={axis}>
                        <h3 className="text-xs uppercase tracking-wide text-amber">{axis}</h3>
                        <ul className="mt-2 space-y-2">
                          {tags.map((tag) => (
                            <li key={`${axis}-${tag.phrase}`} className="text-sm">
                              <span>{tag.phrase}</span>
                              <span className="text-muted"> · {Math.round(tag.confidence * 100)}%</span>
                              {!tag.usable ? <span className="text-muted"> · stored, not used</span> : null}
                              <span className="mt-1 block text-muted">Evidence: {tag.evidence}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )
                  })}
                </div>
                {book.bookId && book.tags.length > 0 ? (
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button onClick={() => void judge(book.bookId!, true)} tone={book.accurate === true ? 'primary' : 'quiet'}>
                      Accurate
                    </Button>
                    <Button onClick={() => void judge(book.bookId!, false)} tone={book.accurate === false ? 'primary' : 'quiet'}>
                      Not accurate
                    </Button>
                  </div>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function statusLabel(book: ReviewBook): string {
  if (book.accurate === true) return 'Marked accurate'
  if (book.accurate === false) return 'Marked not accurate'
  if (book.status === 'tagging') return 'Tagging…'
  if (book.status === 'thin') return 'Not enough text to tag'
  if (book.status === 'failed') return 'Tagging did not finish'
  if (book.status === 'missing') return 'Not loaded'
  if (book.tags.length === 0) return 'Waiting for tags'
  return 'Ready to judge'
}
