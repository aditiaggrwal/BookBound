import { useEffect, useState } from 'react'
import { Atlas } from '../components/Atlas'
import { Cover, Notice, SkeletonRows } from '../components/ui'
import { api, ApiError } from '../lib/api'

type MapMember = {
  bookId: string
  title: string
  authors: string[]
  coverUrl: string | null
  phrase: string
}

type MapLand = {
  id: string
  name: string
  books: MapMember[]
}

type LandBridge = {
  fromLandId: string
  fromLand: string
  nextLandId: string
  nextLand: string
  locked: boolean
  bookId: string
  title: string
  authors: string[]
  coverUrl: string | null
  phrase: string
  reason: string
}

type MapPayload = {
  libraryCount: number
  placedCount: number
  lands: MapLand[]
  forming: MapMember[]
  bridges: LandBridge[]
}

export function MapPage() {
  const [payload, setPayload] = useState<MapPayload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  useEffect(() => {
    void api<MapPayload>('/api/map')
      .then((next) => {
        setPayload(next)
        setSelectedId(next.lands[0]?.id ?? null)
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : 'The map could not be loaded.'))
  }, [])

  if (!payload) return error ? <Notice tone="error">{error}</Notice> : <SkeletonRows />
  const selected = payload.lands.find((land) => land.id === selectedId) ?? payload.lands[0] ?? null
  const offMap = payload.libraryCount - payload.placedCount - payload.forming.length
  const bridge = payload.bridges.find((item) => item.fromLandId === selected?.id) ?? null

  return (
    <div>
      <h1 className="font-serif text-4xl">Your map</h1>
      <p className="mt-3 max-w-2xl text-muted">
        Islands are books you have already read. The foggy shores are still unread. Click an island to see the book that leads there.{' '}
        {payload.placedCount === 1 ? '1 book sits' : `${payload.placedCount} books sit`} on lands.{' '}
        {offMap === 1 ? '1 book is off this map for now.' : `${offMap} books are off this map for now.`}
      </p>
      {payload.lands.length === 0 ? (
        <p className="mt-8 text-muted">No lands yet. Lands appear when several books you have read share a mood.</p>
      ) : (
        <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.55fr)_20rem]">
          <Atlas
            lands={payload.lands.map((land) => ({ id: land.id, name: land.name, count: land.books.length }))}
            selectedId={selected?.id ?? null}
            onSelect={setSelectedId}
            link={bridge ? { fromId: bridge.fromLandId, avoidId: bridge.nextLandId } : null}
          />
          <div className="space-y-6">
            {bridge ? <UnlockCard bridge={bridge} /> : selected ? <p className="rounded-3xl border border-line bg-card p-5 text-sm text-muted">This island does not open another land yet.</p> : null}
            {selected ? <BookPanel title={selected.name} note="Books you have read on this island." books={selected.books} /> : null}
          </div>
        </div>
      )}
      {payload.forming.length > 0 ? (
        <section className="mt-6 rounded-3xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Still finding a shore</h2>
          <p className="mt-2 text-sm text-muted">These are books you have finished. They have real tags, and no shared mood is large enough for a land yet.</p>
          <ul className="mt-4 grid gap-2 sm:grid-cols-2">
            {payload.forming.map((book) => (
              <li key={book.bookId} className="text-sm">
                <span className="text-cream">{book.title}</span>
                <span className="text-muted"> · {book.phrase}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  )
}

function UnlockCard({ bridge }: { bridge: LandBridge }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <p className="text-xs uppercase tracking-wide text-amber">Unread, from {bridge.fromLand}</p>
      <div className="mt-3 flex gap-3">
        <Cover url={bridge.coverUrl} title={bridge.title} />
        <div>
          <h2 className="font-serif text-2xl leading-tight">{bridge.title}</h2>
          <p className="text-sm text-muted">{bridge.authors.join(', ')}</p>
        </div>
      </div>
      <p className="mt-4 text-sm leading-relaxed text-cream">
        This book is still unread. It shares “{bridge.phrase}” with the books on {bridge.fromLand}. Its mood leans {bridge.nextLand}, so the line ends on a fog shore.
      </p>
    </section>
  )
}

function BookPanel({ title, note, books }: { title: string; note: string; books: MapMember[] }) {
  return (
    <section className="rounded-3xl border border-line bg-card p-5">
      <h2 className="font-serif text-3xl">{title}</h2>
      <p className="mt-2 text-sm text-muted">{note}</p>
      <ul className="mt-4 max-h-[32rem] space-y-3 overflow-auto pr-1">
        {books.map((book) => (
          <li key={book.bookId} className="flex gap-3">
            <Cover url={book.coverUrl} title={book.title} />
            <div>
              <p className="font-serif text-lg leading-tight">{book.title}</p>
              <p className="text-sm text-muted">{book.authors.join(', ')}</p>
              <p className="mt-1 text-sm text-amber">{book.phrase}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
