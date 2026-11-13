export class ApiError extends Error {}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    cache: init?.cache ?? 'no-store',
    credentials: 'same-origin',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  const text = await response.text()
  const trimmed = text.trim()
  let body: { message?: string; error?: string; detail?: string } = {}
  const looksJson = trimmed.startsWith('{') || trimmed.startsWith('[')
  if (looksJson) {
    try {
      body = JSON.parse(trimmed) as { message?: string; error?: string; detail?: string }
    } catch {
      body = {}
    }
  }
  if (!response.ok) {
    const snippet = !looksJson ? trimmed.replace(/\s+/g, ' ').slice(0, 140) : ''
    const base =
      body.message ??
      (body.error === 'sign_in_required'
        ? 'Sign in again, then retry the import.'
        : response.status === 503
          ? 'BookBound is still starting. Wait a moment and try again.'
          : response.status === 429
            ? 'Too many requests. Wait a moment and try again.'
            : snippet
              ? `Something went wrong (${response.status}). ${snippet}`
              : `Something went wrong (${response.status}). Try again.`)
    const message =
      body.detail && !base.includes(body.detail) ? `${base} (${body.detail})` : base
    throw new ApiError(message)
  }
  if (!looksJson) {
    throw new ApiError('BookBound could not reach its API. Refresh and try again.')
  }
  return body as T
}
