export interface Config {
  port: number
  production: boolean
}

// All settings come from environment variables, read in one place, so the
// API can move between hosting platforms without code changes.
//
// Uses port 3001 when PORT is not set, so it can run alongside Find funding
// on port 3000.
export function loadConfig (env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: Number(env.PORT) || 3001,
    production: env.NODE_ENV === 'production'
  }
}
