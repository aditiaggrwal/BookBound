import { and, eq, isNull, ne } from 'drizzle-orm'
import { bookEmbeddings, bookTags, books, userBooks } from '@bookbound/db'
import type { Database } from '@bookbound/db'
import { fetchOpenLibraryWork, lookupGoogleBooks, searchOpenLibrary } from '@bookbound/shared/catalog'
import type { TagAxis, TagSets } from '@bookbound/shared'
import { EMBEDDING_AXES } from '@bookbound/shared'
import { completeJson, embedText, resolveMode } from './llm'
import {
  PROMPT_VERSION,
  TAGGING_PROMPT,
  citeTags,
  extractJson,
  fixturePrivateTags,
  fixtureTags,
  isThinBook,
  isUsable,
  parseTagSets,
} from './tags'

const AXES: TagAxis[] = ['atmosphere', 'style', 'idea']

async function generateSharedTags(input: { title: string; authors: string[]; description: string; subjects: string[] }): Promise<TagSets> {
  if (resolveMode() === 'fixture') return fixtureTags(input)
  let lastError = 'The tag response was empty.'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const correction = attempt === 0 ? '' : `\n\nThe previous answer was rejected: ${lastError}. Return corrected JSON only.`
    const user = `Title: ${input.title}\nAuthors: ${input.authors.join(', ')}\nSubjects: ${input.subjects.join('; ')}\nDescription:\n${input.description.slice(0, 6000)}${correction}`
    try {
      const raw = extractJson(await completeJson(TAGGING_PROMPT, user))
      return citeTags(parseTagSets(raw), input)
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'The tag response was invalid.'
    }
  }
  throw new Error(lastError)
}

export async function enrichBook(db: Database, bookId: string): Promise<void> {
  const found = await db.select().from(books).where(eq(books.id, bookId)).limit(1)
  const book = found[0]
  if (!book) throw new Error('This book is no longer in the catalog.')

  let description = book.description
  let subjects = book.subjects ?? []
  let coverUrl = book.coverUrl
  let year = book.year
  let language = book.language
  let openLibraryKey = book.openLibraryKey
  let metadataSource = book.metadataSource

  if (!description || subjects.length === 0) {
    const isbn = book.isbn13 ?? book.isbn10
    let workKey = openLibraryKey
    if (!workKey && isbn) {
      const hits = await searchOpenLibrary({ isbn, limit: 1 })
      const hit = hits[0]
      if (hit) {
        workKey = hit.openLibraryKey
        coverUrl = coverUrl ?? hit.coverUrl
        year = year ?? hit.year
        language = language ?? hit.language
        if (subjects.length === 0) subjects = hit.subjects
        openLibraryKey = openLibraryKey ?? hit.openLibraryKey
      }
    }
    if (workKey) {
      const work = await fetchOpenLibraryWork(workKey)
      description = description ?? work.description
      if (subjects.length === 0) subjects = work.subjects
      metadataSource = metadataSource === 'seed' || !metadataSource ? 'open-library' : metadataSource
    }
  }

  if ((!description || description.length < 120) && process.env.GOOGLE_BOOKS_API_KEY && (book.isbn13 || book.isbn10)) {
    const google = await lookupGoogleBooks(book.isbn13 ?? book.isbn10 ?? '', process.env.GOOGLE_BOOKS_API_KEY)
    if (google) {
      if (!description && google.description) {
        description = google.description
        metadataSource = 'google-books'
      }
      if (subjects.length < 2 && google.subjects.length > 0) subjects = google.subjects
      coverUrl = coverUrl ?? google.coverUrl
      year = year ?? google.year
      language = language ?? google.language
    }
  }

  const thin = isThinBook(description, subjects)
  if (openLibraryKey && openLibraryKey !== book.openLibraryKey) {
    const owner = await db
      .select({ id: books.id })
      .from(books)
      .where(and(eq(books.openLibraryKey, openLibraryKey), ne(books.id, bookId)))
      .limit(1)
    if (owner[0]) openLibraryKey = book.openLibraryKey
  }
  await db
    .update(books)
    .set({
      description,
      subjects,
      coverUrl,
      year,
      language,
      openLibraryKey,
      metadataSource,
      thin,
    })
    .where(eq(books.id, bookId))

  if (thin || !description) return

  const tags = await generateSharedTags({
    title: book.title,
    authors: book.authors,
    description,
    subjects,
  })

  const tagRows = AXES.flatMap((axis) =>
    tags[axis].map((phrase) => ({
      id: crypto.randomUUID(),
      bookId,
      userId: null,
      axis,
      phrase: phrase.phrase,
      confidence: phrase.confidence,
      evidence: phrase.evidence,
      promptVersion: PROMPT_VERSION,
      usable: isUsable(phrase.confidence),
    })),
  )

  const embeddingInputs: Array<{ axis: (typeof EMBEDDING_AXES)[number]; text: string }> = [
    ...AXES.map((axis) => ({ axis, text: tags[axis].map((phrase) => phrase.phrase).join('; ') })),
    { axis: 'combined' as const, text: `${description}\n${AXES.flatMap((axis) => tags[axis].map((phrase) => phrase.phrase)).join('; ')}` },
  ]
  const vectors: Array<{
    id: string
    bookId: string
    axis: (typeof EMBEDDING_AXES)[number]
    embedding: number[]
    model: string
  }> = []
  for (const input of embeddingInputs) {
    const embedded = await embedText(input.text)
    vectors.push({
      id: crypto.randomUUID(),
      bookId,
      axis: input.axis,
      embedding: embedded.vector,
      model: embedded.model,
    })
  }

  await db.transaction(async (tx) => {
    await tx.delete(bookTags).where(and(eq(bookTags.bookId, bookId), isNull(bookTags.userId)))
    await tx.insert(bookTags).values(tagRows)
    await tx.delete(bookEmbeddings).where(eq(bookEmbeddings.bookId, bookId))
    await tx.insert(bookEmbeddings).values(vectors)
  })

  const reviews = await db.select().from(userBooks).where(eq(userBooks.bookId, bookId))
  for (const entry of reviews) {
    const review = entry.reviewText?.trim()
    if (!review || review.length < 40) continue
    const existing = await db
      .select({ id: bookTags.id })
      .from(bookTags)
      .where(and(eq(bookTags.bookId, bookId), eq(bookTags.userId, entry.userId), eq(bookTags.promptVersion, PROMPT_VERSION)))
      .limit(1)
    if (existing.length > 0) continue
    const privateTags = fixturePrivateTags(review).map((phrase) => ({
      id: crypto.randomUUID(),
      bookId,
      userId: entry.userId,
      axis: phrase.axis,
      phrase: phrase.phrase,
      confidence: phrase.confidence,
      evidence: phrase.evidence,
      promptVersion: PROMPT_VERSION,
      usable: isUsable(phrase.confidence),
    }))
    if (privateTags.length > 0) await db.insert(bookTags).values(privateTags)
  }
}
