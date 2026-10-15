export interface Config {
  port: number
  production: boolean
  databaseUrl?: string
}

// The database started by compose.yaml, used locally when DATABASE_URL is
// not set.
export const LOCAL_DATABASE_URL = 'postgres://funding:funding@localhost:5432/funding'

// All settings come from environment variables, read in one place, so the
// API can move between hosting platforms without code changes.
//
// Uses port 3001 when PORT is not set, so it can run alongside Find funding
// on port 3000.
export function loadConfig (env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === 'production'

  return {
    port: Number(env.PORT) || 3001,
    production,
    databaseUrl: env.DATABASE_URL || (production ? undefined : LOCAL_DATABASE_URL)
  }
}
