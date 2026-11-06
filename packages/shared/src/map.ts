const PLACEHOLDER_PHRASES = new Set([
  'quiet unease',
  'tender melancholy',
  'uncanny wonder',
  'warm solitude',
  'creeping dread',
  'sunlit calm',
  'spare prose',
  'close third person',
  'lyrical description',
  'plain speech',
  'fragmented scenes',
  'measured narration',
  'grief and rebuilding',
  'a life under observation',
  'home and departure',
  'power and tenderness',
  'memory as a place',
  'choice and consequence',
])

const LANDS = [
  { id: 'longing', name: 'Longing', words: ['longing', 'wistful', 'nostalgia', 'nostalgic', 'bittersweet', 'melancholy', 'yearning'] },
  { id: 'romance', name: 'Romance', words: ['romantic', 'romance', 'intimacy', 'intimate'] },
  { id: 'dread', name: 'Dread', words: ['dread', 'haunting', 'danger', 'unease', 'unsettling', 'ominous', 'foreboding', 'menace'] },
  { id: 'mystery', name: 'Mystery', words: ['mystery', 'secrets', 'secret'] },
  { id: 'isolation', name: 'Isolation', words: ['isolation', 'claustrophobic', 'solitude'] },
  { id: 'wonder', name: 'Wonder', words: ['wonder', 'enchanted', 'magical', 'awe'] },
  { id: 'home', name: 'Home', words: ['domestic', 'family', 'gentle'] },
  { id: 'history', name: 'History', words: ['historical', 'history'] },
  { id: 'summer', name: 'Summer', words: ['summer'] },
] as const

const MIN_LAND_SIZE = 3

export type MapTag = {
  axis: string
  phrase: string
  confidence: number
  usable?: boolean
}

export type MapBookInput = {
  id: string
  title: string
  authors: string[]
  coverUrl: string | null
  thin?: boolean
  rating?: number | null
  tags: MapTag[]
}

export type MapMember = {
  bookId: string
  title: string
  authors: string[]
  coverUrl: string | null
  phrase: string
}

export type MapLand = {
  id: string
  name: string
  books: MapMember[]
}

export function buildLands(books: MapBookInput[]): { lands: MapLand[]; forming: MapMember[] } {
  const grouped = new Map<string, MapMember[]>()
  const forming: MapMember[] = []

  for (const book of books) {
    const real = book.tags
      .filter((tag) => tag.usable !== false && !PLACEHOLDER_PHRASES.has(tag.phrase))
      .sort((a, b) => atmosphereFirst(a.axis, b.axis) || b.confidence - a.confidence)
    if (real.length === 0) continue
    const atmosphere = real.filter((tag) => tag.axis === 'atmosphere')
    const placed = atmosphere.map((tag) => ({ tag, land: landFor(tag.phrase) })).find((item) => item.land)
    const member: MapMember = {
      bookId: book.id,
      title: book.title,
      authors: book.authors,
      coverUrl: book.coverUrl,
      phrase: placed?.tag.phrase ?? atmosphere[0]?.phrase ?? real[0].phrase,
    }
    if (!placed?.land) {
      forming.push(member)
      continue
    }
    const list = grouped.get(placed.land.id) ?? []
    list.push(member)
    grouped.set(placed.land.id, list)
  }

  const lands: MapLand[] = []
  for (const land of LANDS) {
    const members = grouped.get(land.id) ?? []
    if (members.length < MIN_LAND_SIZE) {
      forming.push(...members)
      continue
    }
    members.sort((a, b) => a.title.localeCompare(b.title))
    lands.push({ id: land.id, name: land.name, books: members })
  }
  forming.sort((a, b) => a.title.localeCompare(b.title))
  lands.sort((a, b) => b.books.length - a.books.length || a.name.localeCompare(b.name))
  return { lands, forming }
}

export type LandBridge = {
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

export function landBridges(
  readBooks: MapBookInput[],
  unreadBooks: MapBookInput[],
  lands: Array<{ id: string; name: string; bookIds: string[] }>,
): LandBridge[] {
  const formed = new Set(lands.map((land) => land.name))
  const byId = new Map(readBooks.map((book) => [book.id, book]))
  const used = new Map<string, number>()
  const bridges: LandBridge[] = []
  for (const land of lands) {
    const phraseBooks = new Map<string, number>()
    for (const bookId of land.bookIds) {
      const book = byId.get(bookId)
      if (!book || book.thin) continue
      for (const phrase of new Set(realTags(book).map((tag) => tag.phrase))) {
        phraseBooks.set(phrase, (phraseBooks.get(phrase) ?? 0) + 1)
      }
    }
    const bestByTheme = new Map<string, { score: number; bridge: LandBridge }>()
    for (const unread of unreadBooks) {
      if (unread.thin) continue
      const next = moodLand(unread)
      const nextLand = next ? LANDS.find((item) => item.name === next) : undefined
      if (!next || !nextLand || next === land.name) continue
      const seen = new Set<string>()
      for (const tag of realTags(unread)) {
        if (seen.has(tag.phrase)) continue
        seen.add(tag.phrase)
        const shared = phraseBooks.get(tag.phrase) ?? 0
        if (shared === 0) continue
        const locked = !formed.has(next)
        const axisBoost = tag.axis === 'idea' ? 4 : tag.axis === 'atmosphere' ? 2 : 0
        const tie = tag.axis === 'style' ? 1 / shared : Math.min(shared, 4) * 0.25
        const score = (locked ? 10 : 0) + axisBoost + tie
        const bridge: LandBridge = {
          fromLandId: land.id,
          fromLand: land.name,
          nextLandId: nextLand.id,
          nextLand: next,
          locked,
          bookId: unread.id,
          title: unread.title,
          authors: unread.authors,
          coverUrl: unread.coverUrl,
          phrase: tag.phrase,
          reason: landBridgeReason(locked, unread.title, land.name, next, tag.phrase),
        }
        const current = bestByTheme.get(next)
        if (!current || score > current.score || (score === current.score && bridge.title < current.bridge.title)) {
          bestByTheme.set(next, { score, bridge })
        }
      }
    }
    let chosen: { score: number; bridge: LandBridge } | null = null
    for (const option of bestByTheme.values()) {
      const score = option.score - (used.get(option.bridge.nextLand) ?? 0) * 6
      if (!chosen || score > chosen.score || (score === chosen.score && option.bridge.title < chosen.bridge.title)) {
        chosen = { score, bridge: option.bridge }
      }
    }
    if (!chosen) continue
    bridges.push(chosen.bridge)
    used.set(chosen.bridge.nextLand, (used.get(chosen.bridge.nextLand) ?? 0) + 1)
  }
  return bridges
}

function landBridgeReason(locked: boolean, title: string, fromLand: string, nextLand: string, phrase: string): string {
  const quoted = `“${phrase}”`
  if (locked) return `Read ${title} to unlock ${nextLand}. It shares ${quoted} with ${fromLand}.`
  return `Read ${title} to cross from ${fromLand} into ${nextLand}. It shares ${quoted} with this island.`
}

function realTags(book: MapBookInput): MapTag[] {
  return book.tags
    .filter((tag) => tag.usable !== false && !PLACEHOLDER_PHRASES.has(tag.phrase))
    .sort((a, b) => b.confidence - a.confidence)
}

function moodLand(book: MapBookInput): string | null {
  for (const tag of realTags(book)) {
    if (tag.axis !== 'atmosphere') continue
    const land = landFor(tag.phrase)
    if (land) return land.name
  }
  return null
}

function landFor(phrase: string): (typeof LANDS)[number] | undefined {
  const words = new Set(phrase.toLowerCase().split(/\s+/))
  return LANDS.find((land) => land.words.some((word) => words.has(word)))
}

function atmosphereFirst(a: string, b: string): number {
  return (a === 'atmosphere' ? 0 : 1) - (b === 'atmosphere' ? 0 : 1)
}
