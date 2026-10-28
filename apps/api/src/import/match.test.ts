import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { mapSearchResponse } from '@bookbound/shared/catalog'
import type { BookCandidate, ParsedBook } from '@bookbound/shared'
import { matchRow, resolveReviewAction } from './match'

function row(partial: Partial<ParsedBook> = {}): ParsedBook {
  return {
    title: 'The Night Circus',
    author: 'Erin Morgenstern',
    authors: ['Erin Morgenstern'],
    isbn10: null,
    isbn13: null,
    rating: 5,
    averageRating: 4,
    dateRead: '2024-01-02',
    dateAdded: '2023-05-01',
    bookshelves: [],
    shelf: 'read',
    review: null,
    ...partial,
  }
}

function candidate(partial: Partial<BookCandidate>): BookCandidate {
  return {
    bookId: null,
    title: 'The Night Circus',
    authors: ['Erin Morgenstern'],
    isbn13: '9780307744432',
    isbn10: '0307744434',
    isbns: ['9780307744432', '0307744434'],
    coverUrl: null,
    year: 2011,
    subjects: ['Circus'],
    openLibraryKey: '/works/OL16086747W',
    description: null,
    language: 'eng',
    source: 'local',
    ...partial,
  }
}

describe('matchRow', () => {
  it('auto-accepts an ISBN13 hit', () => {
    const decision = matchRow(row({ isbn13: '9780307744432' }), [
      candidate({ title: 'Something else', authors: ['Someone else'], isbns: ['9780307744432'] }),
    ])
    expect(decision.status).toBe('auto')
    expect(decision.confidence).toBe(1)
  })

  it('auto-accepts an ISBN10 hit', () => {
    const decision = matchRow(row({ isbn10: '0307744434', isbn13: null }), [
      candidate({ isbns: ['0307744434'], isbn13: null, isbn10: '0307744434' }),
    ])
    expect(decision.status).toBe('auto')
    expect(decision.confidence).toBe(0.98)
  })

  it('auto-accepts a normalized title and author', () => {
    const decision = matchRow(row({ title: 'The Night Circus: A Novel', author: 'Morgenstern, Erin' }), [
      candidate({ isbns: [], isbn13: null, isbn10: null, title: 'Night Circus', authors: ['Erin Morgenstern'] }),
    ])
    expect(decision.status).toBe('auto')
    expect(decision.confidence).toBe(0.95)
  })

  it('auto-accepts a Goodreads series suffix against the main title', () => {
    const decision = matchRow(
      row({
        title: "The Hitchhiker's Guide to the Galaxy (The Hitchhiker's Guide to the Galaxy, #1)",
        author: 'Douglas Adams',
      }),
      [
        candidate({
          title: "The Hitchhiker's Guide to the Galaxy",
          authors: ['Douglas Adams'],
          isbns: [],
          isbn13: null,
          isbn10: null,
        }),
      ],
    )
    expect(decision.status).toBe('auto')
    expect(decision.confidence).toBe(0.95)
  })

  it('auto-accepts a long subtitle against the main title', () => {
    const decision = matchRow(
      row({
        title: 'Atomic Habits: An Easy & Proven Way to Build Good Habits & Break Bad Ones',
        author: 'James Clear',
      }),
      [candidate({ title: 'Atomic Habits', authors: ['James Clear'], isbns: [], isbn13: null, isbn10: null })],
    )
    expect(decision.status).toBe('auto')
    expect(decision.confidence).toBe(0.95)
  })

  it('auto-accepts when the catalog adds a middle initial or a narrator', () => {
    const decision = matchRow(
      row({ title: 'Why We Sleep: Unlocking the Power of Sleep and Dreams', author: 'Matthew Walker' }),
      [candidate({ title: 'Why We Sleep', authors: ['Matthew P. Walker'], isbns: [], isbn13: null, isbn10: null })],
    )
    expect(decision.status).toBe('auto')
    expect(decision.confidence).toBe(0.95)
  })

  it('sends a weaker overlap to review', () => {
    const decision = matchRow(row(), [
      candidate({
        title: 'Night Circus Stories',
        authors: ['Erin Morgenstern'],
        isbns: [],
        isbn13: null,
        isbn10: null,
      }),
    ])
    expect(decision.status).toBe('review')
    expect(decision.confidence).toBeGreaterThanOrEqual(0.55)
    expect(decision.confidence).toBeLessThan(0.95)
    expect(decision.candidate?.title).toBe('Night Circus Stories')
  })

  it('leaves an unrelated row unmatched', () => {
    const decision = matchRow(row({ title: 'Kindred', author: 'Octavia Butler' }), [
      candidate({ title: 'Project Hail Mary', authors: ['Andy Weir'], isbns: [], isbn13: null, isbn10: null }),
    ])
    expect(decision.status).toBe('unmatched')
    expect(decision.candidate).toBeNull()
  })

  it('prefers the ISBN hit over a fuzzy title', () => {
    const decision = matchRow(row({ isbn13: '9780307744432' }), [
      candidate({
        title: 'Night Circus Stories',
        authors: ['Erin Morgenstern'],
        isbns: ['9780000000001'],
        isbn13: '9780000000001',
      }),
      candidate({ title: 'Different title', authors: ['Other'], isbns: ['9780307744432'], isbn13: '9780307744432' }),
    ])
    expect(decision.status).toBe('auto')
    expect(decision.candidate?.isbn13).toBe('9780307744432')
  })

  it('maps a recorded Open Library response and matches the ISBN', () => {
    const fixture = JSON.parse(readFileSync(new URL('../books/fixtures/night-circus-search.json', import.meta.url), 'utf8'))
    const candidates = mapSearchResponse(fixture)
    expect(candidates[0]?.title).toBe('The Night Circus')
    expect(candidates[0]?.coverUrl).toContain('8773134')
    const decision = matchRow(row({ isbn13: '9780307744432' }), candidates)
    expect(decision.status).toBe('auto')
    expect(decision.confidence).toBe(1)
    expect(decision.candidate?.authors).toContain('Erin Morgenstern')
  })
})

describe('resolveReviewAction', () => {
  it('skips a row that is waiting for review', () => {
    expect(resolveReviewAction('review', 'skip')).toBe('skipped')
    expect(resolveReviewAction('unmatched', 'skip')).toBe('skipped')
  })

  it('accepts a review row and refuses an unmatched row without a chosen book', () => {
    expect(resolveReviewAction('review', 'accept')).toBe('accepted')
    expect(() => resolveReviewAction('unmatched', 'accept')).toThrow(/Choose a book/)
  })

  it('refuses to change a row that is already resolved', () => {
    expect(() => resolveReviewAction('auto', 'skip')).toThrow(/already resolved/)
    expect(resolveReviewAction('unmatched', 'choose')).toBe('chosen')
  })
})
