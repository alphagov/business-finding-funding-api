import pg from 'pg'
import type { Config } from './config'

// Connects to the Postgres database in DATABASE_URL.
//
// Heroku Postgres needs an encrypted connection, but its certificates
// cannot be checked against a certificate authority, so Heroku's
// instructions are to turn that check off. The local database does not
// use encryption.
export function createPool (config: Config, options: pg.PoolConfig = {}): pg.Pool {
  if (!config.databaseUrl) throw new Error('DATABASE_URL is not set')

  const pool = new pg.Pool({
    connectionString: config.databaseUrl,
    ssl: config.production ? { rejectUnauthorized: false } : undefined,
    max: 5,
    connectionTimeoutMillis: 5000,
    ...options
  })

  // A connection that drops while idle is replaced, so log it rather than
  // stop the API.
  pool.on('error', (err) => {
    console.error('Lost an idle database connection:', err.message)
  })

  return pool
}
