/** Shared Postgres connection options for hosted and local runtimes. */
export function connectionOptions(url: string) {
  const local = /localhost|127\.0\.0\.1/.test(url)
  return {
    connectionString: url,
    connectionTimeoutMillis: 15_000,
    // Let DATABASE_URL's sslmode drive TLS. Local Docker stays plaintext.
    ...(local ? { ssl: false as const } : {}),
  }
}

export function poolOptions(url: string, overrides: { max?: number; idleTimeoutMillis?: number } = {}) {
  return {
    ...connectionOptions(url),
    max: overrides.max ?? 5,
    idleTimeoutMillis: overrides.idleTimeoutMillis ?? 20_000,
  }
}
