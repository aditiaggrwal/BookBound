import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { ImportRowResult, LibrarySummary } from '@bookbound/shared'
import { Button, Card, Notice } from '../components/ui'
import { api, ApiError } from '../lib/api'
import { assertImportFile, ImportFileError, parseGoodreadsCsv } from '../lib/import/parse'

export function ImportPage() {
  const navigate = useNavigate()
  const abort = useRef<AbortController | null>(null)
  const [useReview, setUseReview] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<number | null>(null)
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [large, setLarge] = useState(false)

  async function onFile(file: File) {
    setError(null)
    setLarge(false)
    try {
      assertImportFile(file)
    } catch (caught) {
      setMessage(null)
      setError(caught instanceof ImportFileError ? caught.message : 'That file could not be read.')
      return
    }
    setBusy(true)
    setLabel('Reading the file…')
    setProgress(0)
    let batchId = ''
    try {
      const parsed = parseGoodreadsCsv(await file.text())
      if (parsed.books.length === 0) {
        setError('That file did not include any books with a title and author.')
        setBusy(false)
        setProgress(null)
        return
      }
      const notes = [
        `${parsed.books.length} books found.`,
        parsed.droppedBlank > 0 ? `${parsed.droppedBlank} blank rows dropped.` : '',
        parsed.collapsedDuplicates > 0 ? `${parsed.collapsedDuplicates} duplicate editions combined.` : '',
      ].filter(Boolean)
      setMessage(notes.join(' '))
      setLarge(parsed.books.length > 2000 || file.size > 2_000_000)
      const rows = parsed.books.map((book, sourceIndex) => ({
        ...book,
        review: useReview ? book.review : null,
        sourceIndex,
      }))
      const batch = await api<{ batchId: string }>('/api/import/batches', {
        method: 'POST',
        body: JSON.stringify({ totalRows: rows.length, useReviewText: useReview }),
      })
      batchId = batch.batchId
      const controller = new AbortController()
      abort.current = controller
      let sent = 0
      let reviewCount = 0
      let unmatchedCount = 0
      for (let index = 0; index < rows.length; index += 200) {
        if (controller.signal.aborted) break
        const slice = rows.slice(index, index + 200)
        const response = await api<{ results: ImportRowResult[] }>(`/api/import/batches/${batchId}/rows`, {
          method: 'POST',
          body: JSON.stringify({ rows: slice }),
          signal: controller.signal,
        })
        sent += slice.length
        reviewCount += response.results.filter((row) => row.status === 'review').length
        unmatchedCount += response.results.filter((row) => row.status === 'unmatched').length
        setProgress(sent / rows.length)
        setLabel(`Matching ${Math.min(sent, rows.length)} of ${rows.length}`)
      }
      if (controller.signal.aborted) {
        navigate(`/library?batch=${batchId}`, {
          state: { note: 'Import stopped. Books already matched are in your library.' },
        })
        return
      }
      await api(`/api/import/batches/${batchId}/complete`, { method: 'POST' })
      const summary = await api<LibrarySummary>('/api/library/summary')
      if (reviewCount > 0 || unmatchedCount > 0) {
        navigate(`/import/review?batch=${batchId}`)
      } else if (summary.ratedCount < 15) {
        navigate(`/import/favorites?from=import&batch=${batchId}`)
      } else {
        navigate(`/library?batch=${batchId}`)
      }
    } catch (caught) {
      if (abort.current?.signal.aborted) {
        if (batchId) {
          navigate(`/library?batch=${batchId}`, {
            state: { note: 'Import stopped. Books already matched are in your library.' },
          })
        }
        return
      }
      setError(caught instanceof ApiError || caught instanceof ImportFileError ? caught.message : 'The import stopped. You can try that file again.')
    } finally {
      setBusy(false)
      abort.current = null
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="font-serif text-4xl">Upload your Goodreads export</h1>
      <p className="mt-3 max-w-2xl text-muted">
        On Goodreads, open My Books, then Import and export, then Export Library. Drop the CSV here.
      </p>
      <Card className="mt-8">
        <label
          className="flex cursor-pointer flex-col items-center rounded-2xl border border-dashed border-line px-6 py-12 text-center"
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            event.preventDefault()
            const file = event.dataTransfer.files[0]
            if (file && !busy) void onFile(file)
          }}
        >
          <span className="font-serif text-2xl">Drop your library CSV</span>
          <span className="mt-2 text-sm text-muted">Up to 10 MB and 20,000 books. Any other file is turned away.</span>
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void onFile(file)
              event.target.value = ''
            }}
          />
          <span className="mt-6 inline-flex min-h-11 items-center rounded-full bg-amber px-5 text-sm font-medium text-ink">
            Choose a file
          </span>
        </label>
        <label className="mt-5 flex items-start gap-3 text-sm text-muted">
          <input
            type="checkbox"
            className="mt-1"
            checked={useReview}
            onChange={(event) => setUseReview(event.target.checked)}
            disabled={busy}
          />
          <span>
            Use my review text to add private tags. It stays on your library and is not added to the shared book record.
          </span>
        </label>
      </Card>
      {message ? <p className="mt-5 font-serif text-xl">{message}</p> : null}
      {large ? (
        <p className="mt-3 text-sm text-muted">
          This library is large. Matching keeps going if you leave, and your library keeps the books already matched.
        </p>
      ) : null}
      {progress !== null ? (
        <div className="mt-5">
          <div
            className="h-2 overflow-hidden rounded-full bg-raised"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label={label}
          >
            <div className="h-full bg-amber" style={{ width: `${Math.round(progress * 100)}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-3">
            <p className="text-sm text-muted">{label}</p>
            {busy ? (
              <Button tone="quiet" onClick={() => abort.current?.abort()}>
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="mt-5">
          <Notice tone="error">{error}</Notice>
        </div>
      ) : null}
    </div>
  )
}
