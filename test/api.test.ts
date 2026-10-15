import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import Ajv2020 from 'ajv/dist/2020'
import pg from 'pg'
import { openApi } from '../src/openapi'
import { loadFunding } from '../src/schemes'
import { startApi, testDatabase, type TestDatabase, type TestServer } from './helpers'

// Checks values against the schemas in the OpenAPI specification. The
// specification's other sections are not JSON Schema, so are ignored.
const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true })
ajv.addSchema({ $id: 'openapi', ...openApi })

function assertMatches (schema: string, value: unknown): void {
  const validate = ajv.getSchema(`openapi#/components/schemas/${schema}`)
  assert.ok(validate, `There is no ${schema} schema`)
  assert.ok(validate(value), ajv.errorsText(validate.errors))
}

let db: TestDatabase
let api: TestServer

before(async () => {
  db = await testDatabase()
  api = await startApi(db.pool)
})

after(async () => {
  api.close()
  await db.close()
})

async function getJson (path: string): Promise<{ res: Response, body: any }> {
  const res = await fetch(`${api.baseUrl}${path}`)
  return { res, body: await res.json() }
}

test('the funding data file matches the published schema', () => {
  const { example, schemes } = loadFunding()
  assertMatches('SchemeList', { example, count: schemes.length, schemes })
})

test('every scheme is listed, in the published format, and can be cached and read by any website', async () => {
  const { res, body } = await getJson('/v1/schemes')

  assert.equal(res.status, 200)
  assert.equal(res.headers.get('access-control-allow-origin'), '*')
  assert.equal(res.headers.get('cache-control'), 'public, max-age=300')
  assertMatches('SchemeList', body)
  assert.equal(body.example, true)
  assert.equal(body.count, loadFunding().schemes.length)
})

test('schemes can be filtered by type, sector and purpose', async () => {
  const types = async (query: string): Promise<string[]> => [...new Set((await getJson(`/v1/schemes?${query}`)).body.schemes.map((s: { type: string }) => s.type))] as string[]

  assert.deepEqual(await types('type=grant'), ['grant'])
  assert.deepEqual((await types('type=loan&type=equity')).sort(), ['equity', 'loan'])

  const ids = async (query: string): Promise<string[]> => (await getJson(`/v1/schemes?${query}`)).body.schemes.map((s: { id: string }) => s.id)
  const forPremises = await ids('purpose=premises')

  // Schemes for premises, and schemes that can be used for anything.
  assert.ok(forPremises.includes('example-leeds-premises-grant'))
  assert.ok(forPremises.includes('example-growth-loan'))
  assert.ok(!forPremises.includes('example-hiring-grant'))
  assert.deepEqual(await ids('sector=manufacturing'), await ids(''))
})

test('filters that are not recognised are reported as problems', async () => {
  for (const [query, detail] of [
    ['type=mortgage', /type must be one of loan, grant, equity. Not recognised: mortgage/],
    ['secter=manufacturing', /Not recognised: secter/]
  ] as const) {
    const { res, body } = await getJson(`/v1/schemes?${query}`)

    assert.equal(res.status, 400)
    assert.equal(res.headers.get('content-type'), 'application/problem+json; charset=utf-8')
    assertMatches('Problem', body)
    assert.match(body.detail, detail)
  }
})

test('one scheme can be read by its identifier', async () => {
  const { res, body } = await getJson('/v1/schemes/example-growth-loan')

  assert.equal(res.status, 200)
  assertMatches('Scheme', body)
  assert.equal(body.name, 'Example Growth Loan')

  const missing = await getJson('/v1/schemes/no-such-scheme')
  assert.equal(missing.res.status, 404)
  assertMatches('Problem', missing.body)
})

test('the specification and documentation are published', async () => {
  const { res, body } = await getJson('/openapi.json')
  assert.equal(res.status, 200)
  assert.equal(body.openapi, '3.1.0')
  assert.deepEqual(Object.keys(body.paths), ['/v1/schemes', '/v1/schemes/{id}'])

  const docs = await fetch(`${api.baseUrl}/docs`)
  const page = await docs.text()
  assert.equal(docs.status, 200)
  assert.match(page, /<title>Funding data API<\/title>/)
  assert.match(page, /swagger-ui-dist@5\.33\.0\/swagger-ui-bundle\.js" integrity="sha384-/)
  assert.match(docs.headers.get('content-security-policy') ?? '', /script-src 'self' https:\/\/cdn\.jsdelivr\.net/)

  assert.match(await (await fetch(`${api.baseUrl}/docs/start.js`)).text(), /url: '\/openapi.json', dom_id: '#swagger-ui', validatorUrl: null/)
  assert.equal((await fetch(`${api.baseUrl}/`, { redirect: 'manual' })).headers.get('location'), '/docs')
  assert.deepEqual((await getJson('/health')).body, { status: 'ok' })
})

test('the health check fails if the database cannot be reached', async () => {
  const unreachable = new pg.Pool({ connectionString: 'postgres://funding:funding@127.0.0.1:1/funding', connectionTimeoutMillis: 1000 })
  const broken = await startApi(unreachable)

  try {
    const res = await fetch(`${broken.baseUrl}/health`)
    assert.equal(res.status, 503)
    assert.deepEqual(await res.json(), { status: 'error' })

    const schemes = await fetch(`${broken.baseUrl}/v1/schemes`)
    assert.equal(schemes.status, 500)
    assertMatches('Problem', await schemes.json())
  } finally {
    broken.close()
    await unreachable.end()
  }
})

test('search engines are asked not to list the API', async () => {
  const robots = await fetch(`${api.baseUrl}/robots.txt`)
  assert.equal(await robots.text(), 'User-agent: *\nDisallow: /\n')
  assert.equal(robots.headers.get('x-robots-tag'), 'noindex, nofollow')
})

test('only reading is allowed', async () => {
  const res = await fetch(`${api.baseUrl}/v1/schemes`, { method: 'POST', body: '{}' })
  assert.equal(res.status, 404)
})
