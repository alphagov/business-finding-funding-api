import fs from 'node:fs'
import path from 'node:path'
import type pg from 'pg'
import { loadConfig } from './config'
import { createPool } from './db'

// Brings the database up to date by running the SQL files in migrations/,
// in name order, that have not been run before. Each runs in a
// transaction, so a file that fails changes nothing.
//
// Migrations are never changed once merged. To change the database, add a
// new file. A rollback on Heroku does not undo a migration, so a migration
// must still work with the code before it.

const MIGRATIONS_DIR = path.join(__dirname, '..', 'migrations')

// Stops two releases running migrations at the same time.
const LOCK_ID = 7_340_219

export async function migrate (pool: pg.Pool, dir = MIGRATIONS_DIR): Promise<string[]> {
  const client = await pool.connect()

  try {
    await client.query('select pg_advisory_lock($1)', [LOCK_ID])
    await client.query('create table if not exists schema_migrations (name text primary key, run_at timestamptz not null default now())')

    const done = new Set((await client.query<{ name: string }>('select name from schema_migrations')).rows.map((row) => row.name))
    const files = fs.readdirSync(dir).filter((file) => file.endsWith('.sql')).sort()
    const run: string[] = []

    for (const file of files.filter((name) => !done.has(name))) {
      try {
        await client.query('begin')
        await client.query(fs.readFileSync(path.join(dir, file), 'utf8'))
        await client.query('insert into schema_migrations (name) values ($1)', [file])
        await client.query('commit')
      } catch (err) {
        await client.query('rollback')
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`)
      }
      run.push(file)
    }

    return run
  } finally {
    await client.query('select pg_advisory_unlock($1)', [LOCK_ID]).catch(() => {})
    client.release()
  }
}

if (require.main === module) {
  const pool = createPool(loadConfig())

  migrate(pool)
    .then((run) => {
      console.log(run.length ? `Ran migrations: ${run.join(', ')}` : 'The database is up to date')
    })
    .catch((err) => {
      console.error(err.message)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
