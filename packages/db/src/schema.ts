import { sql } from 'drizzle-orm'
import { boolean, customType, integer, jsonb, pgTable, real, text, timestamp } from 'drizzle-orm/pg-core'
import type { BookCandidate, ParsedBook } from '@bookbound/shared'

const vector256 = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return 'vector(256)'
  },
  toDriver(value: number[]) {
    return JSON.stringify(value)
  },
  fromDriver(value: string) {
    const body = value.trim().replace(/^\[/, '').replace(/\]$/, '')
    if (!body) return []
    return body.split(',').map((part) => Number(part))
  },
})

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  email: text('email'),
  sessionToken: text('session_token').notNull().unique(),
  settings: jsonb('settings').$type<Record<string, unknown>>().notNull().default({}),
  dataDeletedAt: timestamp('data_deleted_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const books = pgTable('books', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  authors: jsonb('authors').$type<string[]>().notNull(),
  isbn13: text('isbn13'),
  isbn10: text('isbn10'),
  year: integer('year'),
  description: text('description'),
  subjects: jsonb('subjects').$type<string[]>().notNull(),
  coverUrl: text('cover_url'),
  language: text('language'),
  thin: boolean('thin').notNull().default(false),
  metadataSource: text('metadata_source'),
  openLibraryKey: text('open_library_key'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const bookTags = pgTable('book_tags', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull(),
  userId: text('user_id'),
  axis: text('axis').notNull(),
  phrase: text('phrase').notNull(),
  confidence: real('confidence').notNull(),
  evidence: text('evidence').notNull(),
  promptVersion: integer('prompt_version').notNull(),
  usable: boolean('usable').notNull(),
})

export const bookEmbeddings = pgTable('book_embeddings', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull(),
  axis: text('axis').notNull(),
  embedding: vector256('embedding').notNull(),
  model: text('model').notNull(),
})

export const userBooks = pgTable('user_books', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  bookId: text('book_id').notNull(),
  shelf: text('shelf').notNull(),
  rating: real('rating'),
  dateRead: text('date_read'),
  dateAdded: text('date_added'),
  source: text('source').notNull(),
  reviewText: text('review_text'),
  ratingChangedInApp: boolean('rating_changed_in_app').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const importBatches = pgTable('import_batches', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  useReviewText: boolean('use_review_text').notNull().default(false),
  totalRows: integer('total_rows').notNull(),
  status: text('status').notNull(),
  addedCount: integer('added_count').notNull().default(0),
  changedCount: integer('changed_count').notNull().default(0),
  skippedCount: integer('skipped_count').notNull().default(0),
  receivedCount: integer('received_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const importRows = pgTable('import_rows', {
  id: text('id').primaryKey(),
  batchId: text('batch_id').notNull(),
  sourceIndex: integer('source_index').notNull(),
  original: jsonb('original').$type<ParsedBook>().notNull(),
  status: text('status').notNull(),
  confidence: real('confidence').notNull().default(0),
  candidate: jsonb('candidate').$type<BookCandidate | null>(),
  bookId: text('book_id'),
})

export const enrichmentJobs = pgTable('enrichment_jobs', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull(),
  status: text('status').notNull(),
  attempts: integer('attempts').notNull().default(0),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

export const tagReviews = pgTable('tag_reviews', {
  id: text('id').primaryKey(),
  bookId: text('book_id').notNull().unique(),
  userId: text('user_id'),
  accurate: boolean('accurate').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const schema = {
  users,
  books,
  bookTags,
  bookEmbeddings,
  userBooks,
  importBatches,
  importRows,
  enrichmentJobs,
  tagReviews,
}

export const claimJobSql = sql`
  UPDATE enrichment_jobs
  SET status = 'running', started_at = now(), attempts = attempts + 1
  WHERE id = (
    SELECT id FROM enrichment_jobs
    WHERE status = 'pending'
    ORDER BY created_at
    FOR UPDATE SKIP LOCKED
    LIMIT 1
  )
  RETURNING id, book_id, attempts
`
