export class HttpError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

const hits = new Map<string, number[]>()

export function limit(key: string, max: number, windowMs: number): void {
  const now = Date.now()
  const recent = (hits.get(key) ?? []).filter((stamp) => now - stamp < windowMs)
  if (recent.length >= max) {
    throw new HttpError('Too many requests. Wait a moment and try again.', 429)
  }
  recent.push(now)
  hits.set(key, recent)
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}
