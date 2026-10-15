import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { migrate } from '../src/migrate'
import { testDatabase, type TestDatabase } from './helpers'

// The rules the database itself enforces, whichever way data is added.

let db: TestDatabase

before(async () => {
  db = await testDatabase({ load: false })
})

after(async () => {
  await db.close()
})

const SCHEME = "insert into schemes (id, type, name, provider, summary, url, checked_on) values ($1, $2, 'Test scheme', 'Test provider', 'A scheme for tests.', 'https://www.example.com/test', '2026-10-01')"

// Runs the statements in a transaction that is always undone, so each test
// starts from the same empty tables.
async function attempt (...statements: Array<[string, unknown[]?]>): Promise<void> {
  const client = await db.pool.connect()
  try {
    await client.query('begin')
    for (const [sql, params] of statements) await client.query(sql, params)
  } finally {
    await client.query('rollback')
    client.release()
  }
}

test('migrations are recorded, and only run once', async () => {
  assert.deepEqual(await migrate(db.pool), [])

  const { rows } = await db.pool.query('select name from schema_migrations order by name')
  assert.deepEqual(rows.map((row) => row.name), ['001-create-funding-tables.sql', '002-add-list-values.sql', '003-add-ons-areas.sql'])
})

test('the fixed lists and ONS areas are loaded', async () => {
  const count = async (sql: string): Promise<number> => Number((await db.pool.query(sql)).rows[0].count)

  assert.equal(await count('select count(*) from funding_types'), 3)
  assert.equal(await count('select count(*) from sectors'), 30)
  assert.equal(await count('select count(*) from purposes'), 13)
  assert.equal(await count("select count(*) from areas where level = 'country'"), 4)
  assert.equal(await count("select count(*) from areas where level = 'region'"), 9)
  assert.equal(await count("select count(*) from areas where level = 'local-authority'"), 361)
})

test('a scheme can be saved with values from the lists', async () => {
  await attempt(
    [SCHEME, ['test-loan', 'loan']],
    ["insert into loan_details (scheme_id, interest_rate) values ('test-loan', '8% a year')"],
    ["insert into scheme_sectors (scheme_id, sector) values ('test-loan', 'manufacturing')"],
    ["insert into scheme_areas (scheme_id, area_code) values ('test-loan', 'E06000047')"],
    ["insert into scheme_business_stages (scheme_id, business_stage) values ('test-loan', 'trading')"]
  )
})

test('values that are not on the lists cannot be saved', async () => {
  await assert.rejects(attempt([SCHEME, ['test-loan', 'mortgage']]), /violates foreign key constraint/)

  for (const [table, column, value] of [
    ['scheme_sectors', 'sector', 'Creative Industries'],
    ['scheme_purposes', 'purpose', 'HERITAGE'],
    ['scheme_business_stages', 'business_stage', 'start_up'],
    ['scheme_legal_structures', 'legal_structure', 'social_enterprise'],
    // The old Durham County Council code, replaced in 2009.
    ['scheme_areas', 'area_code', 'E10000007']
  ]) {
    await assert.rejects(
      attempt([SCHEME, ['test-loan', 'loan']], [`insert into ${table} (scheme_id, ${column}) values ('test-loan', $1)`, [value]]),
      /violates foreign key constraint/,
      `${table} accepted ${value}`
    )
  }
})

test('details for one type of funding cannot be added to another', async () => {
  await assert.rejects(
    attempt([SCHEME, ['test-grant', 'grant']], ["insert into loan_details (scheme_id, interest_rate) values ('test-grant', '8% a year')"]),
    /violates foreign key constraint/
  )
})

test('values in the wrong format are not saved', async () => {
  const update = (set: string): Promise<void> => attempt([SCHEME, ['test-loan', 'loan']], [`update schemes set ${set} where id = 'test-loan'`])

  for (const set of [
    "id = 'Test Loan'",
    "url = 'http://www.example.com'",
    "name = ''",
    'amount_min = 10, amount_max = 5',
    'amount_min = -1',
    'match_funding_percent = 120',
    "review_by = '2026-01-01'",
    "replaced_by = 'test-loan'",
    "premises_tenure = 'lease'"
  ]) {
    await assert.rejects(update(set), /violates check constraint/, set)
  }

  await assert.rejects(update("status = 'closed'"), /violates foreign key constraint/)
  await assert.rejects(
    attempt(["insert into areas (code, name, level) values ('E12000010', 'Not a local authority', 'local-authority')"]),
    /violates check constraint "areas_ons_code"/
  )
})

test('removing a scheme removes its details and lists', async () => {
  await attempt(
    [SCHEME, ['test-loan', 'loan']],
    ["insert into loan_details (scheme_id) values ('test-loan')"],
    ["insert into scheme_eligibility (scheme_id, position, criterion) values ('test-loan', 1, 'Any business')"],
    ["delete from schemes where id = 'test-loan'"],
    ["do $$ begin if exists (select 1 from loan_details) or exists (select 1 from scheme_eligibility) then raise exception 'details were left behind'; end if; end $$"]
  )
})
