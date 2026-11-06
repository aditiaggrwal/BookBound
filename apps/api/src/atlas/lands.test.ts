import { describe, expect, it } from 'vitest'
import { buildLands, type MapBookInput } from '@bookbound/shared'

function book(partial: Partial<MapBookInput> & Pick<MapBookInput, 'id' | 'title'>): MapBookInput {
  return {
    authors: ['Author'],
    coverUrl: null,
    tags: [],
    ...partial,
  }
}

describe('buildLands', () => {
  it('groups books that share a mood and keeps placeholder tags off the map', () => {
    const romantic = (id: string, title: string): MapBookInput =>
      book({
        id,
        title,
        tags: [{ axis: 'atmosphere', phrase: 'witty romantic tension', confidence: 0.9, usable: true }],
      })
    const { lands, forming } = buildLands([
      romantic('1', 'Beach Read'),
      romantic('2', 'Happy Place'),
      romantic('3', 'Book Lovers'),
      book({
        id: '4',
        title: 'Placeholder',
        tags: [{ axis: 'atmosphere', phrase: 'tender melancholy', confidence: 0.74, usable: true }],
      }),
    ])
    expect(lands.map((land) => land.name)).toEqual(['Romance'])
    expect(lands[0]?.books.map((item) => item.title)).toEqual(['Beach Read', 'Book Lovers', 'Happy Place'])
    expect(forming).toEqual([])
  })

  it('keeps a book title from becoming a land name', () => {
    const { lands } = buildLands([
      book({
        id: '1',
        title: 'The Midnight Library',
        tags: [{ axis: 'atmosphere', phrase: 'quiet wonder', confidence: 0.8, usable: true }],
      }),
      book({
        id: '2',
        title: 'The Night Circus',
        tags: [{ axis: 'atmosphere', phrase: 'seductive wonder', confidence: 0.9, usable: true }],
      }),
      book({
        id: '3',
        title: 'Piranesi',
        tags: [{ axis: 'atmosphere', phrase: 'marble wonder', confidence: 0.7, usable: true }],
      }),
    ])
    expect(lands.map((land) => land.name)).toEqual(['Wonder'])
    expect(lands[0]?.books.map((item) => item.title)).toContain('The Midnight Library')
  })

  it('holds a lone mood with the books still finding a shore', () => {
    const { lands, forming } = buildLands([
      book({
        id: '1',
        title: 'Kindred',
        tags: [{ axis: 'atmosphere', phrase: 'disorienting displacement', confidence: 0.92, usable: true }],
      }),
    ])
    expect(lands).toEqual([])
    expect(forming.map((item) => item.title)).toEqual(['Kindred'])
  })
})
