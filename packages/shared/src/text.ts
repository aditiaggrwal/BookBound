const TITLE_LEADING = new Set(['a', 'an', 'the'])

export function cleanIsbn(raw: string | null | undefined): string | null {
  if (!raw) return null
  let value = raw.trim()
  const wrapped = value.match(/^=\s*"?(.*?)"?\s*$/)
  if (wrapped) value = wrapped[1] ?? ''
  value = value.replace(/[^0-9Xx]/g, '')
  if (value.length === 13 && (value.startsWith('978') || value.startsWith('979'))) return value
  if (value.length === 10) return value.toUpperCase()
  return null
}

const SERIES_PARENS = /\s*\([^)]*#\s*\d+[^)]*\)/g

export function catalogTitle(input: string): string {
  const withoutSeries = input.replace(SERIES_PARENS, ' ')
  const head = withoutSeries.split(':')[0] ?? withoutSeries
  return head.replace(/\s+/g, ' ').trim()
}

export function normalizeTitle(input: string): string {
  const head = catalogTitle(input)
  const tokens = head
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  while (tokens.length > 1 && TITLE_LEADING.has(tokens[0] ?? '')) tokens.shift()
  return tokens.join(' ')
}

export function normalizeAuthor(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ')
}

export function tokenOverlap(leftText: string, rightText: string): number {
  const left = new Set(leftText.split(' ').filter(Boolean))
  const right = new Set(rightText.split(' ').filter(Boolean))
  if (left.size === 0 || right.size === 0) return 0
  let shared = 0
  for (const token of left) if (right.has(token)) shared += 1
  const union = new Set([...left, ...right])
  return shared / union.size
}

export function titlesMatch(left: string, right: string): boolean {
  const normalized = normalizeTitle(left)
  return normalized.length > 0 && normalized === normalizeTitle(right)
}

export function authorsMatch(left: string, right: string): boolean {
  const normalized = normalizeAuthor(left)
  return normalized.length > 0 && normalized === normalizeAuthor(right)
}

export function authorListed(userAuthor: string, candidateAuthors: string): boolean {
  const wanted = normalizeAuthor(userAuthor)
    .split(' ')
    .filter((token) => token.length > 1)
  const found = new Set(normalizeAuthor(candidateAuthors).split(' ').filter(Boolean))
  return wanted.length > 0 && wanted.every((token) => found.has(token))
}
