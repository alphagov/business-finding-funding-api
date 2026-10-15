import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadConfig } from '../src/config'

test('config uses defaults when nothing is set', () => {
  assert.deepEqual(loadConfig({}), { port: 3001, production: false })
})

test('config reads settings from the environment', () => {
  assert.deepEqual(loadConfig({ PORT: '8080', NODE_ENV: 'production' }), { port: 8080, production: true })
})
