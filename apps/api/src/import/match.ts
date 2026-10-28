import { authorListed, titlesMatch, tokenOverlap, normalizeAuthor, normalizeTitle } from '@bookbound/shared'
import type { BookCandidate, ParsedBook, RowStatus } from '@bookbound/shared'

export const AUTO_CONFIDENCE = 0.95
export const REVIEW_CONFIDENCE = 0.55

export type MatchDecision = {
  status: 'auto' | 'review' | 'unmatched'
  confidence: number
  candidate: BookCandidate | null
}

export type ReviewAction = 'accept' | 'skip' | 'choose'

export function scoreCandidate(row: ParsedBook, candidate: BookCandidate): number {
  if (row.isbn13 && candidate.isbns.includes(row.isbn13)) return 1
  if (row.isbn13 && candidate.isbn13 === row.isbn13) return 1
  if (row.isbn10 && (candidate.isbns.includes(row.isbn10) || candidate.isbn10 === row.isbn10)) return 0.98
  const authorText = candidate.authors.join(' ')
  if (titlesMatch(row.title, candidate.title) && authorListed(row.author, authorText)) return 0.95
  const titleScore = tokenOverlap(normalizeTitle(row.title), normalizeTitle(candidate.title))
  const authorScore = tokenOverlap(normalizeAuthor(row.author), normalizeAuthor(authorText))
  return titleScore * 0.7 + authorScore * 0.3
}

export function matchRow(row: ParsedBook, candidates: BookCandidate[]): MatchDecision {
  let best: BookCandidate | null = null
  let bestScore = 0
  for (const candidate of candidates) {
    if (!candidate.title.trim()) continue
    const score = scoreCandidate(row, candidate)
    if (score > bestScore) {
      best = candidate
      bestScore = score
    }
  }
  const confidence = Number(bestScore.toFixed(4))
  if (!best || confidence < REVIEW_CONFIDENCE) {
    return { status: 'unmatched', confidence, candidate: null }
  }
  if (confidence >= AUTO_CONFIDENCE) return { status: 'auto', confidence, candidate: best }
  return { status: 'review', confidence, candidate: best }
}

export function resolveReviewAction(current: RowStatus, action: ReviewAction): RowStatus {
  if (current !== 'review' && current !== 'unmatched') {
    throw new Error('This row is already resolved.')
  }
  if (action === 'skip') return 'skipped'
  if (action === 'accept') {
    if (current !== 'review') throw new Error('Choose a book before accepting this row.')
    return 'accepted'
  }
  return 'chosen'
}
