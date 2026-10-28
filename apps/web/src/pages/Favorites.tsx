import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { BookCandidate, LibrarySummary } from '@bookbound/shared'
import { Button, Card, Cover, Notice, SkeletonRows } from '../components/ui'
import { api, ApiError } from '../lib/api'

export function FavoritesPage() {
  const [params] = useSearchParams()
  const mode = params.get('from') === 'cold' ? 'cold' : 'import'
  const batch = params.get('batch')
  const navigate = useNavigate()
  const [summary, setSummary] = useState<LibrarySummary | null>(null)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<BookCandidate[]>([])
  const [rating, setRating] = useState(5)
  const [added, setAdded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [searching, setSearching] = useState(false)

  async function refresh() {
    setSummary(await api<LibrarySummary>('/api/library/summary'))
  }

  useEffect(() => {
    void refresh().catch((caught) => setError(caught instanceof ApiError ? caught.message : 'Your library could not be loaded.'))
  }, [])

  async function search() {
    setSearching(true)
    setError(null)
    try {
      const body = await api<{ results: BookCandidate[] }>(`/api/books/search?q=${encodeURIComponent(query)}`)
      setResults(body.results)
      if (body.results.length === 0) setError('No books matched that search.')
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Search failed. Try again.')
    } finally {
      setSearching(false)
    }
  }

  async function add(candidate: BookCandidate) {
    if (added >= 10) return
    setError(null)
    try {
      await api('/api/library/favorites', {
        method: 'POST',
        body: JSON.stringify({ candidate, rating }),
      })
      setAdded((count) => count + 1)
      setResults((current) => current.filter((item) => item !== candidate))
      await refresh()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That book was not added.')
    }
  }

  const rated = summary?.ratedCount ?? 0
  const canContinue = mode === 'cold' ? rated >= 3 : true

  if (!summary) return error ? <Notice tone="error">{error}</Notice> : <SkeletonRows />

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-4xl">{mode === 'cold' ? 'Start from three books you love' : 'Add a few favorites'}</h1>
      <p className="mt-3 text-muted">
        {mode === 'cold'
          ? 'Search for three books you already know you love. The library is labeled early until you have rated 15.'
          : `You have ${rated} rated book${rated === 1 ? '' : 's'}. Add up to 10 favorites so the early library has more to grow from.`}
      </p>
      <form
        className="mt-6 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label className="sr-only" htmlFor="favorite-search">
          Search by title or author
        </label>
        <input
          id="favorite-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-h-11 min-w-64 flex-1 rounded-full border border-line bg-raised px-4 text-cream"
          placeholder="Title or author"
        />
        <label className="flex items-center gap-2 text-sm text-muted">
          Rating
          <select
            value={rating}
            onChange={(event) => setRating(Number(event.target.value))}
            className="min-h-11 rounded-full border border-line bg-raised px-3 text-cream"
            aria-label="Rating for the books you add"
          >
            {[5, 4, 3, 2, 1].map((value) => (
              <option key={value} value={value}>
                {value === 1 ? "1 star" : `${value} stars`}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" disabled={searching || query.trim().length < 2}>
          Search
        </Button>
      </form>
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      <p className="mt-4 text-sm text-muted">{added} of 10 favorites added in this step.</p>
      <ul className="mt-4 space-y-3">
        {results.map((candidate) => (
          <li key={`${candidate.title}-${candidate.isbn13 ?? candidate.openLibraryKey ?? ''}`}>
            <Card>
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <Cover url={candidate.coverUrl} title={candidate.title} />
                  <div>
                    <h2 className="font-serif text-xl">{candidate.title}</h2>
                    <p className="text-sm text-muted">{candidate.authors.join(', ')}</p>
                  </div>
                </div>
                <Button onClick={() => void add(candidate)} disabled={added >= 10}>
                  Add
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <Button
          disabled={!canContinue}
          onClick={() => navigate(batch ? `/library?batch=${batch}` : '/library')}
        >
          Continue to your library
        </Button>
        {!canContinue ? <p className="mt-3 text-sm text-muted">Add three books to continue.</p> : null}
      </div>
    </div>
  )
}
