import { describe, expect, it } from 'vitest'
import { ImportFileError, assertImportFile, parseGoodreadsCsv, TOO_MANY_ROWS_MESSAGE, WRONG_FILE_MESSAGE } from './parse'

const header =
  'Book Id,Title,Author,Author l-f,Additional Authors,ISBN,ISBN13,My Rating,Average Rating,Publisher,Binding,Number of Pages,Year Published,Original Publication Year,Date Read,Date Added,Bookshelves,Bookshelves with positions,Exclusive Shelf,My Review,Spoiler,Private Notes,Read Count,Owned Copies'

function line(fields: Record<string, string>): string {
  return header
    .split(',')
    .map((column) => {
      const value = fields[column] ?? ''
      return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
    })
    .join(',')
}

function csv(rows: string[]): string {
  return [header, ...rows].join('\n')
}

describe('parseGoodreadsCsv', () => {
  it('unwraps Goodreads ISBN formulas and keeps a quoted review', () => {
    const result = parseGoodreadsCsv(
      csv([
        line({
          'Book Id': '1',
          Title: 'The Night Circus',
          Author: 'Erin Morgenstern',
          'Author l-f': 'Morgenstern, Erin',
          ISBN: '="0307744434"',
          ISBN13: '="9780307744432"',
          'My Rating': '5',
          'Average Rating': '4.01',
          'Date Read': '2024/01/02',
          'Date Added': '2023/05/01',
          Bookshelves: 'favorites',
          'Exclusive Shelf': 'read',
          'My Review': 'A glowing review, with a comma.',
        }),
      ]),
    )
    expect(result.books).toHaveLength(1)
    expect(result.books[0]).toMatchObject({
      title: 'The Night Circus',
      isbn10: '0307744434',
      isbn13: '9780307744432',
      rating: 5,
      shelf: 'read',
      dateRead: '2024-01-02',
      review: 'A glowing review, with a comma.',
    })
  })

  it('drops blank rows', () => {
    const result = parseGoodreadsCsv(
      csv([
        line({ 'Book Id': '9' }),
        line({
          Title: 'Kindred',
          Author: 'Octavia Butler',
          ISBN13: '="9780807083697"',
          'My Rating': '5',
          'Exclusive Shelf': 'read',
        }),
      ]),
    )
    expect(result.droppedBlank).toBe(1)
    expect(result.books.map((book) => book.title)).toEqual(['Kindred'])
  })

  it('collapses duplicate editions and keeps the higher rating', () => {
    const result = parseGoodreadsCsv(
      csv([
        line({
          Title: 'The Night Circus',
          Author: 'Erin Morgenstern',
          ISBN13: '="9780307744432"',
          'My Rating': '4',
          'Date Read': '2019/01/02',
          'Date Added': '2018/05/01',
          'Exclusive Shelf': 'read',
        }),
        line({
          Title: 'The Night Circus',
          Author: 'Erin Morgenstern',
          ISBN13: '="9780307744432"',
          'My Rating': '5',
          'Date Read': '2024/01/02',
          'Date Added': '2023/05/01',
          'Exclusive Shelf': 'read',
        }),
      ]),
    )
    expect(result.collapsedDuplicates).toBe(1)
    expect(result.books).toHaveLength(1)
    expect(result.books[0]?.rating).toBe(5)
    expect(result.books[0]?.dateAdded).toBe('2018-05-01')
    expect(result.books[0]?.dateRead).toBe('2024-01-02')
  })

  it('combines editions that share a title and author when the ISBN is missing', () => {
    const result = parseGoodreadsCsv(
      csv([
        line({
          Title: 'The Night Circus',
          Author: 'Erin Morgenstern',
          'My Rating': '0',
          'Date Added': '2020/01/01',
          'Exclusive Shelf': 'to-read',
        }),
        line({
          Title: 'The Night Circus: A Novel',
          Author: 'Morgenstern, Erin',
          'My Rating': '5',
          'Date Read': '2024/01/02',
          'Date Added': '2019/01/01',
          'Exclusive Shelf': 'read',
        }),
      ]),
    )
    expect(result.books).toHaveLength(1)
    expect(result.books[0]?.rating).toBe(5)
    expect(result.books[0]?.shelf).toBe('read')
  })

  it('maps currently-reading and did-not-finish shelves', () => {
    const result = parseGoodreadsCsv(
      csv([
        line({ Title: 'Piranesi', Author: 'Susanna Clarke', 'Exclusive Shelf': 'currently-reading' }),
        line({ Title: 'Dune', Author: 'Frank Herbert', Bookshelves: 'did-not-finish', 'Exclusive Shelf': 'read', 'My Rating': '2' }),
      ]),
    )
    expect(result.books.map((book) => book.shelf)).toEqual(['reading', 'did-not-finish'])
  })

  it('treats a zero rating as unrated', () => {
    const result = parseGoodreadsCsv(csv([line({ Title: 'Circe', Author: 'Madeline Miller', 'My Rating': '0', 'Exclusive Shelf': 'to-read' })]))
    expect(result.books[0]?.rating).toBeNull()
    expect(result.books[0]?.shelf).toBe('to-read')
  })

  it('rejects a file that is not a Goodreads export', () => {
    expect(() => parseGoodreadsCsv('name,age\nAda,36')).toThrow(WRONG_FILE_MESSAGE)
  })

  it('rejects more than 20,000 rows', () => {
    const rows = Array.from({ length: 20001 }, (_, index) => line({ Title: `Book ${index}`, Author: 'Author', 'My Rating': '1' }))
    expect(() => parseGoodreadsCsv(csv(rows))).toThrow(TOO_MANY_ROWS_MESSAGE)
  })
})

describe('assertImportFile', () => {
  it('rejects a file that is not a csv', () => {
    expect(() => assertImportFile({ name: 'library.txt', size: 100 })).toThrow(ImportFileError)
  })

  it('rejects a file over 10 MB', () => {
    expect(() => assertImportFile({ name: 'library.csv', size: 10 * 1024 * 1024 + 1 })).toThrow(/10 MB/)
  })

  it('accepts a csv under the size limit', () => {
    expect(() => assertImportFile({ name: 'goodreads_library_export.csv', size: 2000 })).not.toThrow()
  })
})
