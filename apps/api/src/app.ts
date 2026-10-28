import { Hono } from 'hono'
import type { Database } from '@bookbound/db'
import { HttpError, limit } from './http'
import {
  addFavorite,
  batchSummary,
  completeBatch,
  createBatch,
  importRowsForBatch,
  resolveImportRow,
  reviewRows,
  searchCatalog,
} from './import/service'
import type { ReviewAction } from './import/match'
import { getUser } from './session'
import { judgeTags, librarySummary, listLibrary, loadReviewSeed, retryTagging, reviewSet, setRating } from './review/service'

export function createApp(state: { db: Database | null }) {
  const app = new Hono()

  app.onError((error, c) => {
    if (error instanceof HttpError) return c.json({ message: error.message }, error.status as 400)
    console.error(error)
    return c.json({ message: 'Something went wrong. Try again.' }, 500)
  })

  app.use('*', async (c, next) => {
    const length = Number(c.req.header('content-length') ?? 0)
    if (length > 2_000_000) return c.json({ message: 'That upload is too large. Send a smaller batch.' }, 413)
    await next()
  })

  app.get('/api/health', (c) => c.json({ ok: state.db !== null }))

  app.use('/api/*', async (c, next) => {
    if (c.req.path === '/api/health') return next()
    if (!state.db) return c.json({ message: 'BookBound is still connecting to its database.' }, 503)
    await next()
  })

  const db = () => {
    if (!state.db) throw new HttpError('BookBound is still connecting to its database.', 503)
    return state.db
  }

  app.post('/api/import/batches', async (c) => {
    const user = await getUser(c, db())
    limit(`import:${user.id}`, 30, 60 * 60 * 1000)
    const body = await c.req.json().catch(() => null)
    const totalRows = body && typeof body === 'object' && 'totalRows' in body ? Number(body.totalRows) : NaN
    const useReviewText = Boolean(body && typeof body === 'object' && 'useReviewText' in body && body.useReviewText)
    const id = await createBatch(db(), user.id, totalRows, useReviewText)
    return c.json({ batchId: id })
  })

  app.post('/api/import/batches/:id/rows', async (c) => {
    const user = await getUser(c, db())
    limit(`rows:${user.id}`, 400, 60 * 60 * 1000)
    const body = await c.req.json().catch(() => null)
    const rows = body && typeof body === 'object' && 'rows' in body && Array.isArray(body.rows) ? body.rows : null
    if (!rows) throw new HttpError('Send the books as a list.', 400)
    const results = await importRowsForBatch(db(), user.id, c.req.param('id'), rows)
    return c.json({ results })
  })

  app.get('/api/import/batches/:id', async (c) => {
    const user = await getUser(c, db())
    return c.json(await batchSummary(db(), user.id, c.req.param('id')))
  })

  app.get('/api/import/batches/:id/rows', async (c) => {
    const user = await getUser(c, db())
    return c.json({ rows: await reviewRows(db(), user.id, c.req.param('id')) })
  })

  app.post('/api/import/batches/:id/complete', async (c) => {
    const user = await getUser(c, db())
    return c.json(await completeBatch(db(), user.id, c.req.param('id')))
  })

  app.post('/api/import/rows/:id/:action', async (c) => {
    const user = await getUser(c, db())
    const action = c.req.param('action')
    if (action !== 'accept' && action !== 'skip' && action !== 'choose') {
      throw new HttpError('That action is not available.', 404)
    }
    const body = action === 'choose' ? await c.req.json().catch(() => null) : null
    const chosen = body && typeof body === 'object' && 'candidate' in body ? body.candidate : undefined
    const result = await resolveImportRow(db(), user.id, c.req.param('id'), action as ReviewAction, chosen)
    return c.json(result)
  })

  app.get('/api/books/search', async (c) => {
    const user = await getUser(c, db())
    limit(`search:${user.id}`, 40, 60 * 1000)
    const query = c.req.query('q') ?? ''
    return c.json({ results: await searchCatalog(db(), query) })
  })

  app.get('/api/library/summary', async (c) => {
    const user = await getUser(c, db())
    return c.json(await librarySummary(db(), user.id))
  })

  app.get('/api/library', async (c) => {
    const user = await getUser(c, db())
    const offset = Math.max(0, Number(c.req.query('offset') ?? 0) || 0)
    const limitCount = Math.min(200, Math.max(1, Number(c.req.query('limit') ?? 100) || 100))
    return c.json(await listLibrary(db(), user.id, offset, limitCount))
  })

  app.post('/api/library/favorites', async (c) => {
    const user = await getUser(c, db())
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || !('candidate' in body)) {
      throw new HttpError('Choose a book from the search results.', 400)
    }
    const rating = 'rating' in body && typeof body.rating === 'number' ? body.rating : 5
    if (rating !== null && (rating < 0.5 || rating > 5)) throw new HttpError('Choose a rating from 1 to 5.', 400)
    return c.json(await addFavorite(db(), user.id, body.candidate, rating))
  })

  app.patch('/api/library/:userBookId', async (c) => {
    const user = await getUser(c, db())
    const body = await c.req.json().catch(() => null)
    const rating = body && typeof body === 'object' && 'rating' in body ? body.rating : undefined
    if (rating !== null && typeof rating !== 'number') throw new HttpError('Choose a rating from 1 to 5, or clear it.', 400)
    if (typeof rating === 'number' && (rating < 0.5 || rating > 5)) throw new HttpError('Choose a rating from 1 to 5.', 400)
    await setRating(db(), user.id, c.req.param('userBookId'), rating ?? null)
    return c.json({ ok: true })
  })

  app.post('/api/library/:bookId/retry', async (c) => {
    const user = await getUser(c, db())
    await retryTagging(db(), user.id, c.req.param('bookId'))
    return c.json({ ok: true })
  })

  app.post('/api/review/seed', async (c) => {
    await getUser(c, db())
    return c.json(await loadReviewSeed(db()))
  })

  app.get('/api/review/tags', async (c) => {
    await getUser(c, db())
    return c.json(await reviewSet(db()))
  })

  app.post('/api/review/tags', async (c) => {
    const user = await getUser(c, db())
    const body = await c.req.json().catch(() => null)
    if (!body || typeof body !== 'object' || typeof body.bookId !== 'string' || typeof body.accurate !== 'boolean') {
      throw new HttpError('Mark the tags accurate or not.', 400)
    }
    await judgeTags(db(), user.id, body.bookId, body.accurate)
    return c.json({ ok: true })
  })

  return app
}
