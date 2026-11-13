/** Hosted bundle stub — local PGlite is not available in the serverless function. */
export async function createLocalDb(): Promise<never> {
  throw new Error('Local PGlite is not available in the hosted app.')
}
