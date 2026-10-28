import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router'
import type { BatchSummary, BookCandidate, ImportRowResult, LibrarySummary } from '@bookbound/shared'
import { Button, Card, Cover, Notice, SkeletonRows } from '../components/ui'
import { api, ApiError } from '../lib/api'

export function ReviewPage() {
  const [params] = useSearchParams()
  const batchId = params.get('batch') ?? ''
  const navigate = useNavigate()
  const [rows, setRows] = useState<ImportRowResult[] | null>(null)
  const [summary, setSummary] = useState<BatchSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [continuing, setContinuing] = useState(false)

  async function load() {
    const [rowBody, batch] = await Promise.all([
      api<{ rows: ImportRowResult[] }>(`/api/import/batches/${batchId}/rows`),
      api<BatchSummary>(`/api/import/batches/${batchId}`),
    ])
    setRows(rowBody.rows)
    setSummary(batch)
  }

  useEffect(() => {
    if (!batchId) return
    void load().catch((caught) => setError(caught instanceof ApiError ? caught.message : 'The match list could not be loaded.'))
  }, [batchId])

  const waiting = rows?.filter((row) => row.status === 'review') ?? []
  const unmatched = rows?.filter((row) => row.status === 'unmatched') ?? []

  async function act(row: ImportRowResult, action: 'accept' | 'skip' | 'choose', candidate?: BookCandidate) {
    setError(null)
    try {
      await api(`/api/import/rows/${row.rowId}/${action}`, {
        method: 'POST',
        body: action === 'choose' ? JSON.stringify({ candidate }) : undefined,
      })
      await load()
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'That choice was not saved.')
    }
  }

  async function continueOn() {
    setContinuing(true)
    try {
      const library = await api<LibrarySummary>('/api/library/summary')
      if (library.ratedCount < 15) navigate(`/import/favorites?from=import&batch=${batchId}`)
      else navigate(`/library?batch=${batchId}`)
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'The library could not be opened.')
      setContinuing(false)
    }
  }

  if (!batchId) return <Notice tone="error">This match review needs an import to look at.</Notice>
  if (!rows) return <SkeletonRows />

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-4xl">Check the uncertain matches</h1>
      <p className="mt-3 text-muted">
        {summary ? `${summary.added} added, ${summary.changed} updated, ${summary.skipped} skipped.` : 'Loading the counts.'}{' '}
        Unmatched books never block the rest of the library.
      </p>
      {error ? (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
      {waiting.length === 0 && unmatched.length === 0 ? (
        <Card className="mt-6">
          <p>Every row is resolved.</p>
        </Card>
      ) : null}
      <div className="mt-6 space-y-4">
        {waiting.map((row) => (
          <MatchCard key={row.rowId} row={row} onAct={act} />
        ))}
      </div>
      {unmatched.length > 0 ? (
        <div className="mt-10">
          <h2 className="font-serif text-2xl">Skipped for now</h2>
          <p className="mt-2 text-sm text-muted">These rows did not find a confident book. You can search for one, or leave them out.</p>
          <div className="mt-4 space-y-4">
            {unmatched.map((row) => (
              <MatchCard key={row.rowId} row={row} onAct={act} />
            ))}
          </div>
        </div>
      ) : null}
      <div className="mt-8">
        <Button onClick={() => void continueOn()} disabled={waiting.length > 0 || continuing}>
          Continue
        </Button>
      </div>
    </div>
  )
}

function MatchCard({
  row,
  onAct,
}: {
  row: ImportRowResult
  onAct: (row: ImportRowResult, action: 'accept' | 'skip' | 'choose', candidate?: BookCandidate) => Promise<void>
}) {
  const [query, setQuery] = useState(row.title)
  const [results, setResults] = useState<BookCandidate[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const percent = Math.round(row.confidence * 100)

  async function search() {
    setSearching(true)
    setSearchError(null)
    try {
      const body = await api<{ results: BookCandidate[] }>(`/api/books/search?q=${encodeURIComponent(query)}`)
      setResults(body.results)
      if (body.results.length === 0) setSearchError('No books matched that search.')
    } catch (caught) {
      setSearchError(caught instanceof ApiError ? caught.message : 'Search failed. Try again.')
    } finally {
      setSearching(false)
    }
  }

  return (
    <Card>
      <p className="text-sm text-muted">
        From your export: {row.title} by {row.author}
      </p>
      {row.candidate ? (
        <div className="mt-4 flex gap-4">
          <Cover url={row.candidate.coverUrl} title={row.candidate.title} />
          <div>
            <h2 className="font-serif text-2xl">{row.candidate.title}</h2>
            <p className="text-sm text-muted">{row.candidate.authors.join(', ') || 'Author unknown'}</p>
            <p className="mt-1 text-sm text-amber">Best guess, {percent}% match</p>
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted">No confident match.</p>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {row.candidate && row.status === 'review' ? (
          <Button onClick={() => void onAct(row, 'accept')}>Accept</Button>
        ) : null}
        <Button tone="quiet" onClick={() => void onAct(row, 'skip')}>
          Skip
        </Button>
      </div>
      <form
        className="mt-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void search()
        }}
      >
        <label className="sr-only" htmlFor={`search-${row.rowId}`}>
          Choose another book for {row.title}
        </label>
        <input
          id={`search-${row.rowId}`}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="min-h-11 flex-1 rounded-full border border-line bg-raised px-4 text-cream"
        />
        <Button type="submit" tone="quiet" disabled={searching}>
          Choose another
        </Button>
      </form>
      {searchError ? <p className="mt-3 text-sm text-muted">{searchError}</p> : null}
      <ul className="mt-3 space-y-2">
        {results.map((candidate) => (
          <li key={`${candidate.openLibraryKey ?? candidate.title}-${candidate.isbn13 ?? ''}`}>
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-xl border border-line px-3 py-2 text-left hover:border-amber"
              onClick={() => void onAct(row, 'choose', candidate)}
            >
              <Cover url={candidate.coverUrl} title={candidate.title} />
              <span>
                <span className="block font-serif text-lg">{candidate.title}</span>
                <span className="text-sm text-muted">{candidate.authors.join(', ')}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
