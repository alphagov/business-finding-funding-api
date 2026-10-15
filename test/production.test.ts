import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { startApi, type TestServer } from './helpers'

let server: TestServer

before(async () => {
  server = await startApi({ production: true })
})

after(() => {
  server.close()
})

test('plain HTTP requests are redirected to HTTPS', async () => {
  const res = await fetch(`${server.baseUrl}/v1/schemes?type=loan`, {
    headers: { 'X-Forwarded-Proto': 'http' },
    redirect: 'manual'
  })

  assert.equal(res.status, 301)
  assert.equal(res.headers.get('location'), `${server.baseUrl.replace('http:', 'https:')}/v1/schemes?type=loan`)
})

test('HTTPS requests are answered', async () => {
  const res = await fetch(`${server.baseUrl}/health`, { headers: { 'X-Forwarded-Proto': 'https' } })

  assert.equal(res.status, 200)
  assert.deepEqual(await res.json(), { status: 'ok' })
})
