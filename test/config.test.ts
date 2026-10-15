import assert from 'node:assert/strict'
import { test } from 'node:test'
import { LOCAL_DATABASE_URL, loadConfig } from '../src/config'

test('config uses the local database when nothing is set', () => {
  assert.deepEqual(loadConfig({}), { port: 3001, production: false, databaseUrl: LOCAL_DATABASE_URL })
})

test('config reads settings from the environment', () => {
  assert.deepEqual(
    loadConfig({ PORT: '8080', NODE_ENV: 'production', DATABASE_URL: 'postgres://user:secret@db.example.com:5432/funding' }),
    { port: 8080, production: true, databaseUrl: 'postgres://user:secret@db.example.com:5432/funding' }
  )
})

test('in production, the database must be set', () => {
  assert.equal(loadConfig({ NODE_ENV: 'production' }).databaseUrl, undefined)
})
