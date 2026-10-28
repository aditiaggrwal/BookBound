import { describe, expect, it } from 'vitest'
import { citeTags, extractJson, fixtureTags, isUsable, parseTagSets, TagValidationError } from './tags'

const description = 'The circus arrives without warning and leaves a hush over the city. Two rivals practice a private magic. Memory keeps the tents standing after the lights go out.'
const subjects = ['Circus', 'Magic']

function phrase(partial: Partial<{ phrase: string; confidence: number; evidence: string }> = {}) {
  return {
    phrase: partial.phrase ?? 'quiet unease',
    confidence: partial.confidence ?? 0.8,
    evidence: partial.evidence ?? 'leaves a hush over the city',
  }
}

function sets(count = 3) {
  const evidence = [
    'leaves a hush over the city',
    'Two rivals practice a private magic',
    'Memory keeps the tents standing',
    'Circus',
    'Magic',
    'without warning',
    'The circus arrives without warning',
  ]
  const build = (prefix: string) =>
    Array.from({ length: count }, (_, index) =>
      phrase({ evidence: evidence[index] ?? evidence[0], phrase: `${prefix} ${index}` }),
    )
  return {
    atmosphere: build('quiet unease'),
    style: build('spare prose'),
    idea: build('grief and rebuilding'),
  }
}

describe('parseTagSets', () => {
  it('accepts 3 to 6 cited phrases on each axis', () => {
    expect(parseTagSets(sets(3)).atmosphere).toHaveLength(3)
    expect(parseTagSets(sets(6)).style).toHaveLength(6)
  })

  it('rejects too few and too many phrases', () => {
    expect(() => parseTagSets(sets(2))).toThrow(TagValidationError)
    expect(() => parseTagSets(sets(7))).toThrow(TagValidationError)
  })

  it('rejects a phrase without evidence', () => {
    const raw = sets(3)
    raw.atmosphere[0] = phrase({ evidence: ' ' })
    expect(() => parseTagSets(raw)).toThrow(/evidence/)
  })

  it('rejects confidence outside 0 to 1', () => {
    const raw = sets(3)
    raw.idea[1] = phrase({ confidence: 1.2 })
    expect(() => parseTagSets(raw)).toThrow(/confidence/)
  })

  it('reads JSON wrapped in a fence', () => {
    const parsed = extractJson('```json\n{"atmosphere":[]}\n```')
    expect(parsed).toEqual({ atmosphere: [] })
  })
})

describe('citation and usability', () => {
  it('drops evidence that is not in the description or subjects', () => {
    const raw = parseTagSets(sets(4))
    raw.atmosphere[3] = phrase({ evidence: 'a sentence nobody wrote', phrase: 'invented mood' })
    const cited = citeTags(raw, { description, subjects })
    expect(cited.atmosphere.map((item) => item.phrase)).not.toContain('invented mood')
  })

  it('rejects an axis left with fewer than 3 cited phrases', () => {
    const raw = parseTagSets(sets(3))
    raw.style = raw.style.map((item) => ({ ...item, evidence: 'not in the source' }))
    expect(() => citeTags(raw, { description, subjects })).toThrow(/style evidence/)
  })

  it('marks confidence below 0.6 as stored but unused', () => {
    expect(isUsable(0.6)).toBe(true)
    expect(isUsable(0.59)).toBe(false)
  })

  it('builds fixture tags whose evidence is in the source text', () => {
    const tags = fixtureTags({ title: 'The Night Circus', description, subjects })
    expect(tags.atmosphere.length).toBeGreaterThanOrEqual(3)
    for (const axis of ['atmosphere', 'style', 'idea'] as const) {
      for (const item of tags[axis]) {
        const haystack = `${description}\n${subjects.join('\n')}`.toLowerCase()
        expect(haystack).toContain(item.evidence.toLowerCase())
      }
    }
  })
})
