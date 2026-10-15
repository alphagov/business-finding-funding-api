import crypto from 'node:crypto'
import type { AddressInfo } from 'node:net'
import pg from 'pg'
import { createApiApp } from '../src/app'
import type { Config } from '../src/config'
import { loadSchemes } from '../src/load'
import { migrate } from '../src/migrate'
import { loadFunding } from '../src/schemes'
import { postgresStore, type SchemeStore } from '../src/store'

export interface TestServer {
  baseUrl: string
  close: () => void
}

export interface TestDatabase {
  pool: pg.Pool
  close: () => Promise<void>
}

// The database started by compose.yaml, or by the GitHub Actions workflow.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgres://funding:funding@localhost:5432/funding_test'

// Creates the test database the first time the tests run.
async function createTestDatabase (url: URL): Promise<void> {
  const server = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).href })
  await server.connect()

  try {
    await server.query(`create database ${url.pathname.slice(1)}`)
  } catch (err) {
    // Another test file created it first.
    if (!['42P04', '23505'].includes((err as { code?: string }).code ?? '')) throw err
  } finally {
    await server.end()
  }
}

// Gives each test file its own empty schema in the test database, brought
// up to date by the migrations and loaded with the example schemes. Test
// files can then run at the same time without affecting each other.
export async function testDatabase ({ load = true } = {}): Promise<TestDatabase> {
  const url = new URL(TEST_DATABASE_URL)
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`The tests only use a database on this computer, so they cannot change a real one. TEST_DATABASE_URL is set to ${url.hostname}`)
  }

  const schema = `test_${crypto.randomBytes(6).toString('hex')}`
  const admin = new pg.Pool({ connectionString: url.href, max: 1 })

  try {
    await admin.query(`create schema ${schema}`)
  } catch (err) {
    if ((err as { code?: string }).code !== '3D000') throw err
    await createTestDatabase(url)
    await admin.query(`create schema ${schema}`)
  }

  const pool = new pg.Pool({ connectionString: url.href, options: `-c search_path=${schema}` })
  await migrate(pool)
  if (load) await loadSchemes(pool, loadFunding())

  return {
    pool,
    close: async () => {
      await pool.end()
      await admin.query(`drop schema ${schema} cascade`)
      await admin.end()
    }
  }
}

// Starts the API on a free port.
export async function startApi (store: SchemeStore | pg.Pool, config: Partial<Config> = {}): Promise<TestServer> {
  const schemes = store instanceof pg.Pool ? postgresStore(store) : store
  const server = createApiApp({ port: 0, production: false, ...config }, schemes).listen(0)
  await new Promise((resolve) => server.once('listening', resolve))
  const { port } = server.address() as AddressInfo

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => server.close()
  }
}
