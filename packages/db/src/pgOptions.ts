/** Shared Postgres connection options for hosted and local runtimes. */
export function postgresOptions(url: string, overrides: { max?: number; idle_timeout?: number } = {}) {
  const local = /localhost|127\.0\.0\.1/.test(url)
  return {
    max: overrides.max ?? 5,
    idle_timeout: overrides.idle_timeout ?? 20,
    connect_timeout: 15,
    // Transaction poolers (common for hosted Postgres) reject prepared statements.
    prepare: false as const,
    // Verify TLS on hosted databases. Local Docker Postgres stays plaintext.
    // Prefer URL sslmode when present; otherwise require verified TLS remotely.
    ssl: local ? false : ({ rejectUnauthorized: true } as const),
  }
}
