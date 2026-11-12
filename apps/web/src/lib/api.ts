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
  const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string }
  if (!response.ok) {
    const message =
      body.message ??
      (body.error === 'sign_in_required'
        ? 'Sign in again, then retry the import.'
        : response.status === 503
          ? 'BookBound is still starting. Wait a moment and try again.'
          : 'Something went wrong. Try again.')
    throw new ApiError(message)
  }
  return body as T
}

