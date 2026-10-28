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
  const body = (await response.json().catch(() => ({}))) as { message?: string }
  if (!response.ok) {
    throw new ApiError(body.message ?? 'Something went wrong. Try again.')
  }
  return body as T
}
