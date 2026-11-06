import { describe, expect, it } from 'vitest'
import { landBridges, type MapBookInput } from '@bookbound/shared'

function book(partial: Partial<MapBookInput> & Pick<MapBookInput, 'id' | 'title' | 'tags'>): MapBookInput {
  return { authors: ['Author'], coverUrl: null, ...partial }
}

const romance = [
  book({
    id: '1',
    title: 'Beach Read',
    tags: [
      { axis: 'atmosphere', phrase: 'witty romantic tension', confidence: 0.9, usable: true },
      { axis: 'idea', phrase: 'second chances', confidence: 0.8, usable: true },
    ],
  }),
  book({
    id: '2',
    title: 'Book Lovers',
    tags: [{ axis: 'atmosphere', phrase: 'witty romantic tension', confidence: 0.9, usable: true }],
  }),
  book({
    id: '3',
    title: 'Happy Place',
    tags: [{ axis: 'atmosphere', phrase: 'witty romantic tension', confidence: 0.9, usable: true }],
  }),
]

describe('landBridges', () => {
  it('opens a foggy land from the island you click, through one unread book', () => {
    const unread = [
      book({
        id: '4',
        title: 'Same Shore',
        tags: [{ axis: 'atmosphere', phrase: 'witty romantic tension', confidence: 0.9, usable: true }],
      }),
      book({
        id: '5',
        title: 'The Night Circus',
        tags: [
          { axis: 'atmosphere', phrase: 'seductive wonder', confidence: 0.9, usable: true },
          { axis: 'idea', phrase: 'second chances', confidence: 0.7, usable: true },
        ],
      }),
    ]
    const [bridge] = landBridges(romance, unread, [{ id: 'romance', name: 'Romance', bookIds: ['1', '2', '3'] }])
    expect(bridge?.fromLand).toBe('Romance')
    expect(bridge?.nextLand).toBe('Wonder')
    expect(bridge?.locked).toBe(true)
    expect(bridge?.title).toBe('The Night Circus')
    expect(bridge?.phrase).toBe('second chances')
    expect(bridge?.reason).toContain('unlock Wonder')
    expect(bridge?.reason).toContain('Romance')
  })

  it('prefers a land that is not on the map yet', () => {
    const unread = [
      book({
        id: '5',
        title: 'The Night Circus',
        tags: [
          { axis: 'atmosphere', phrase: 'seductive wonder', confidence: 0.9, usable: true },
          { axis: 'idea', phrase: 'second chances', confidence: 0.7, usable: true },
        ],
      }),
      book({
        id: '6',
        title: 'Mexican Gothic',
        tags: [
          { axis: 'atmosphere', phrase: 'gothic dread', confidence: 0.9, usable: true },
          { axis: 'idea', phrase: 'second chances', confidence: 0.9, usable: true },
        ],
      }),
    ]
    const bridges = landBridges(romance, unread, [
      { id: 'romance', name: 'Romance', bookIds: ['1', '2', '3'] },
      { id: 'dread', name: 'Dread', bookIds: ['7', '8', '9'] },
    ])
    expect(bridges.find((bridge) => bridge.fromLand === 'Romance')?.nextLand).toBe('Wonder')
  })

  it('sends neighboring islands toward different themes', () => {
    const dreadBooks = [
      book({
        id: '7',
        title: 'Hamnet',
        tags: [{ axis: 'idea', phrase: 'second chances', confidence: 0.8, usable: true }],
      }),
      book({
        id: '8',
        title: 'Rebecca',
        tags: [{ axis: 'atmosphere', phrase: 'quiet dread', confidence: 0.8, usable: true }],
      }),
      book({
        id: '9',
        title: 'Dracula',
        tags: [{ axis: 'atmosphere', phrase: 'gothic dread', confidence: 0.8, usable: true }],
      }),
    ]
    const unread = [
      book({
        id: '5',
        title: 'The Night Circus',
        tags: [
          { axis: 'atmosphere', phrase: 'seductive wonder', confidence: 0.9, usable: true },
          { axis: 'idea', phrase: 'second chances', confidence: 0.8, usable: true },
        ],
      }),
      book({
        id: '6',
        title: 'Piranesi',
        tags: [
          { axis: 'atmosphere', phrase: 'lonely isolation', confidence: 0.9, usable: true },
          { axis: 'idea', phrase: 'second chances', confidence: 0.8, usable: true },
        ],
      }),
    ]
    const bridges = landBridges([...romance, ...dreadBooks], unread, [
      { id: 'romance', name: 'Romance', bookIds: ['1', '2', '3'] },
      { id: 'dread', name: 'Dread', bookIds: ['7', '8', '9'] },
    ])
    const themes = bridges.map((bridge) => bridge.nextLand)
    expect(new Set(themes).size).toBe(themes.length)
  })

  it('does not use a placeholder tag or a thin unread book', () => {
    const read = [
      book({
        id: '1',
        title: 'Finished',
        tags: [{ axis: 'idea', phrase: 'second chances', confidence: 0.8, usable: true }],
      }),
    ]
    const unread = [
      book({
        id: '2',
        title: 'Waiting',
        tags: [{ axis: 'atmosphere', phrase: 'tender melancholy', confidence: 0.8, usable: true }],
      }),
      book({
        id: '3',
        title: 'Too Thin',
        thin: true,
        tags: [
          { axis: 'atmosphere', phrase: 'quiet wonder', confidence: 0.9, usable: true },
          { axis: 'idea', phrase: 'second chances', confidence: 0.9, usable: true },
        ],
      }),
    ]
    expect(landBridges([...read, ...romance], unread, [{ id: 'romance', name: 'Romance', bookIds: ['1'] }])).toEqual([])
  })
})
