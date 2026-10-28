import type { TagAxis, TagPhrase, TagSets } from '@bookbound/shared'

export const PROMPT_VERSION = 1
export const USABLE_CONFIDENCE = 0.6

export const TAGGING_PROMPT = `You tag books for BookBound. Return JSON only, with this shape:
{"atmosphere":[{"phrase":"","confidence":0.0,"evidence":""}],"style":[],"idea":[]}
Each list has 3 to 6 items.
phrase: 2 to 6 words, lowercase, no punctuation. Not a genre label such as fantasy. Not a plot summary.
atmosphere answers how it feels to be inside the book. Examples: uncanny wonder, cozy melancholy, creeping dread.
style answers how it is written. Examples: field-note voice, spare prose, unreliable narrator.
idea answers what it is really about. Examples: nature unbothered by humans, grief and rebuilding.
confidence is from 0 to 1. Use below 0.6 when the text barely supports the phrase.
evidence is a short quote copied from the description, or one subject heading copied exactly. Do not invent evidence.
Do not praise the book. Do not add events that are not in the description.`

export class TagValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TagValidationError'
  }
}

const AXES: TagAxis[] = ['atmosphere', 'style', 'idea']

export function extractJson(text: string): unknown {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/)
  return JSON.parse(fenced?.[1] ?? trimmed)
}

export function parseTagSets(raw: unknown): TagSets {
  if (!raw || typeof raw !== 'object') throw new TagValidationError('Tags must be an object.')
  const record = raw as Record<string, unknown>
  const sets = {} as TagSets
  for (const axis of AXES) {
    const list = record[axis]
    if (!Array.isArray(list)) throw new TagValidationError(`${axis} must be a list.`)
    if (list.length < 3 || list.length > 6) throw new TagValidationError(`${axis} needs 3 to 6 phrases.`)
    sets[axis] = list.map((item, index) => parsePhrase(item, `${axis} ${index + 1}`))
  }
  return sets
}

function parsePhrase(item: unknown, label: string): TagPhrase {
  if (!item || typeof item !== 'object') throw new TagValidationError(`${label} must be an object.`)
  const row = item as Record<string, unknown>
  if (typeof row.phrase !== 'string') throw new TagValidationError(`${label} needs a phrase.`)
  const phrase = row.phrase.trim()
  if (phrase.length < 2 || phrase.length > 80) throw new TagValidationError(`${label} phrase must be 2 to 80 characters.`)
  if (typeof row.confidence !== 'number' || !Number.isFinite(row.confidence) || row.confidence < 0 || row.confidence > 1) {
    throw new TagValidationError(`${label} confidence must be between 0 and 1.`)
  }
  if (typeof row.evidence !== 'string') throw new TagValidationError(`${label} needs evidence.`)
  const evidence = row.evidence.trim()
  if (evidence.length < 2 || evidence.length > 400) throw new TagValidationError(`${label} needs evidence.`)
  return { phrase, confidence: row.confidence, evidence }
}

export function isUsable(confidence: number): boolean {
  return confidence >= USABLE_CONFIDENCE
}

export function foldText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

export function citeTags(sets: TagSets, source: { description: string; subjects: string[] }): TagSets {
  const haystack = foldText(`${source.description}\n${source.subjects.join('\n')}`)
  const cited = {} as TagSets
  for (const axis of AXES) {
    cited[axis] = sets[axis].filter((phrase) => haystack.includes(foldText(phrase.evidence)))
    if (cited[axis].length < 3 || cited[axis].length > 6) {
      throw new TagValidationError(`${axis} evidence is not in the description or subjects.`)
    }
  }
  return cited
}

const FIXTURE_PHRASES: Record<TagAxis, string[]> = {
  atmosphere: ['quiet unease', 'tender melancholy', 'uncanny wonder', 'warm solitude', 'creeping dread', 'sunlit calm'],
  style: ['spare prose', 'close third person', 'lyrical description', 'plain speech', 'fragmented scenes', 'measured narration'],
  idea: ['grief and rebuilding', 'a life under observation', 'home and departure', 'power and tenderness', 'memory as a place', 'choice and consequence'],
}

function hashText(text: string): number {
  let value = 0
  for (let index = 0; index < text.length; index += 1) value = (value * 33 + text.charCodeAt(index)) >>> 0
  return value
}

export function evidencePool(description: string, subjects: string[]): string[] {
  const sentences = description
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20)
  const pool = [...sentences, ...subjects.map((subject) => subject.trim()).filter(Boolean)]
  if (pool.length === 0 && description.trim()) pool.push(description.trim().slice(0, 180))
  return pool
}

export function fixtureTags(input: { title: string; description: string; subjects: string[] }): TagSets {
  const pool = evidencePool(input.description, input.subjects)
  if (pool.length === 0) throw new TagValidationError('Not enough text to tag this book.')
  const start = hashText(input.title)
  const sets = {} as TagSets
  AXES.forEach((axis, axisIndex) => {
    const phrases = FIXTURE_PHRASES[axis]
    sets[axis] = [0, 1, 2, 3].map((offset) => ({
      phrase: phrases[(start + axisIndex * 3 + offset) % phrases.length] ?? phrases[0],
      confidence: 0.74,
      evidence: pool[(start + offset) % pool.length] ?? pool[0],
    }))
  })
  return citeTags(sets, input)
}

export function isThinBook(description: string | null, subjects: string[]): boolean {
  const text = (description ?? '').replace(/\s+/g, ' ').trim()
  return text.length < 120 && subjects.length < 2
}

export function fixturePrivateTags(review: string): Array<TagPhrase & { axis: TagAxis }> {
  const sentences = review
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length >= 20)
  if (sentences.length === 0 && review.trim().length >= 40) sentences.push(review.trim().slice(0, 180))
  return sentences.slice(0, 3).flatMap((evidence) => {
    const phrase = evidence
      .replace(/[^a-zA-Z\s]/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 5)
      .join(' ')
      .toLowerCase()
    if (phrase.length < 2 || phrase.length > 80) return []
    if (!foldText(review).includes(foldText(evidence))) return []
    return [{ axis: 'idea' as const, phrase, confidence: 0.7, evidence }]
  })
}
