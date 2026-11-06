import { and, eq, inArray, isNull } from 'drizzle-orm'
import { bookTags, books, userBooks } from '@bookbound/db'
import type { Database } from '@bookbound/db'
import { buildLands, landBridges, type MapBookInput } from '@bookbound/shared'

export async function readMap(db: Database, userId: string) {
  const library = await db
    .select({ bookId: userBooks.bookId, shelf: userBooks.shelf, rating: userBooks.rating })
    .from(userBooks)
    .where(eq(userBooks.userId, userId))
  const readIds = library.filter((entry) => entry.shelf === 'read').map((entry) => entry.bookId)
  const unreadIds = library.filter((entry) => entry.shelf === 'to-read').map((entry) => entry.bookId)
  const ratings = new Map(library.map((entry) => [entry.bookId, entry.rating]))
  if (readIds.length === 0) return { libraryCount: 0, placedCount: 0, lands: [], forming: [], bridges: [] }
  const ids = [...readIds, ...unreadIds]
  const bookRows = await db.select().from(books).where(inArray(books.id, ids))
  const tagRows = await db
    .select()
    .from(bookTags)
    .where(and(inArray(bookTags.bookId, ids), isNull(bookTags.userId)))
  const tagsByBook = new Map<string, MapBookInput['tags']>()
  for (const tag of tagRows) {
    const list = tagsByBook.get(tag.bookId) ?? []
    list.push({ axis: tag.axis, phrase: tag.phrase, confidence: tag.confidence, usable: tag.usable })
    tagsByBook.set(tag.bookId, list)
  }
  const toInput = (book: (typeof bookRows)[number]): MapBookInput => ({
    id: book.id,
    title: book.title,
    authors: book.authors,
    coverUrl: book.coverUrl,
    thin: book.thin,
    rating: ratings.get(book.id) ?? null,
    tags: tagsByBook.get(book.id) ?? [],
  })
  const readBooks = bookRows.filter((book) => readIds.includes(book.id)).map(toInput)
  const unreadBooks = bookRows.filter((book) => unreadIds.includes(book.id)).map(toInput)
  const { lands, forming } = buildLands(readBooks)
  return {
    libraryCount: readIds.length,
    placedCount: lands.reduce((sum, land) => sum + land.books.length, 0),
    lands,
    forming,
    bridges: landBridges(
      readBooks,
      unreadBooks,
      lands.map((land) => ({ id: land.id, name: land.name, bookIds: land.books.map((book) => book.bookId) })),
    ),
  }
}
