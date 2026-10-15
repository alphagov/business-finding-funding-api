import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, test } from 'node:test'
import Ajv2020 from 'ajv/dist/2020'
import { openApi } from '../src/openapi'
import { postgresStore } from '../src/store'
import { convertWorkbook, type Lists } from '../src/tpx/convert'
import { importWorkbook, readLists, report } from '../src/tpx/import'
import { BUSINESS_STAGES, GOALS, SECTORS, SPEND_TYPES, STATUSES, SUPPORT_SPEEDS, UK_WIDE_AREAS } from '../src/tpx/mapping'
import { readWorkbook, type Cell, type Workbook } from '../src/tpx/workbook'
import { testDatabase, type TestDatabase } from './helpers'

// test/fixtures/tpx-workbook.xlsx has made-up schemes in the columns of
// TPX's One Platform schema workbook (version 1.3): three that can be
// imported, a loan that appears twice, and a grant with problems.
const WORKBOOK = path.join(__dirname, 'fixtures', 'tpx-workbook.xlsx')

let db: TestDatabase
let lists: Lists

before(async () => {
  db = await testDatabase({ load: false })
  lists = await readLists(db.pool)
})

after(async () => {
  await db.close()
})

// A workbook with one row, for testing one value at a time.
function oneRow (sheet: string, values: Record<string, Cell>): Workbook {
  const row = {
    scheme_id: 'test_scheme',
    scheme_name: 'Test scheme',
    help_type: { Loans: 'LOAN', Grants: 'GRANT', Equities: 'EQUITY' }[sheet] ?? null,
    provider_name: 'Test provider',
    summary_what: 'A scheme for tests.',
    summary_criteria: 'Any business',
    source_url: 'https://www.example.com/test',
    status: 'open',
    verified_date: new Date('2026-09-09'),
    support_goals: 'GROWTH',
    area_level: 'national',
    area_codes: 'K02000001',
    ...values
  }
  return { rows: [{ sheet, row: 2, values: row }], columns: { [sheet]: Object.keys(row) } }
}

test('the workbook sheets are read, with the headings tidied', async () => {
  const { rows, columns } = await readWorkbook(WORKBOOK)

  assert.deepEqual(rows.map((row) => `${row.sheet} ${row.row} ${String(row.values.scheme_id)}`), [
    'Loans 2 example_start_up_loan',
    'Loans 3 example_duplicated_loan',
    'Loans 4 example_duplicated_loan',
    'Grants 2 example_county_grant',
    'Grants 3 example_broken_grant',
    'Equities 2 example_regional_equity'
  ])
  assert.ok(columns.Loans.includes('premises_tenure'), 'the heading with a non-breaking space is tidied')
  assert.ok(columns.Loans.includes('speed_to_support'), 'headings are read in lower case')
  assert.ok(rows[0].values.verified_date instanceof Date)
})

test('schemes are mapped to our lists', async () => {
  const { records } = convertWorkbook(await readWorkbook(WORKBOOK), lists)
  const byId = Object.fromEntries(records.map((record) => [record.id, record]))

  assert.deepEqual(Object.keys(byId), ['example_start_up_loan', 'example_county_grant', 'example_regional_equity'])

  const loan = byId.example_start_up_loan
  assert.equal(loan.type, 'loan')
  assert.equal(loan.example, false)
  assert.deepEqual(loan.purposes, ['start-business', 'grow-sales', 'cash-flow'])
  assert.deepEqual(loan.businessStages, ['pre-start', 'first-year'])
  assert.deepEqual(loan.sectors, [], 'any sector')
  assert.deepEqual(loan.areas, [], 'the whole UK')
  assert.deepEqual(loan.legalStructures, ['limited-company', 'sole-trader'])
  assert.deepEqual(loan.eligibility, ['Based in the UK', 'Aged 18 or over', 'Can afford repayments'])
  assert.equal(loan.supportSpeed, 'less-than-1-month')
  assert.equal(loan.checkedOn, '2026-09-09')
  assert.deepEqual(loan.loan, { interestRate: 'Fixed at 7.5% a year', repaymentTerm: '1 to 5 years', fees: 'None' })

  const grant = byId.example_county_grant
  assert.deepEqual(grant.purposes, ['equipment', 'premises', 'energy'], 'social impact has no purpose, so is left out')
  assert.deepEqual(grant.spendTypes, ['capital', 'revenue'])
  assert.deepEqual(grant.sectors, ['manufacturing', 'technology'])
  assert.deepEqual(grant.areas, ['E10000007'])
  assert.equal(grant.supportSpeed, '4-to-6-months')
  assert.equal(grant.closesOn, '2026-11-30')
  assert.equal(grant.matchFundingPercent, 50)
  assert.equal(grant.grant?.paidInArrears, true)

  const equity = byId.example_regional_equity
  assert.equal(equity.equity?.investmentType, 'Venture capital')
  assert.equal(equity.equity?.followOnInvestmentAvailable, true)
  assert.deepEqual(equity.areas, ['E12000001', 'E12000002'])
})

test('schemes with problems are not imported, and every problem is reported', async () => {
  const conversion = convertWorkbook(await readWorkbook(WORKBOOK), lists)

  assert.deepEqual(conversion.rejected, [
    { id: 'example_duplicated_loan', sheet: 'Loans', row: 3, problems: ['scheme_id is also used on Loans row 4'] },
    { id: 'example_duplicated_loan', sheet: 'Loans', row: 4, problems: ['scheme_id is also used on Loans row 3'] },
    {
      id: 'example_broken_grant',
      sheet: 'Grants',
      row: 3,
      problems: [
        'source_url must be a web address starting https://, not http://www.example.com/broken',
        'closing_date must be a date or ROLLING, not "Opens late 2026"',
        'sectors "Space Tourism" is not on our list and has no mapping',
        'support_goals "HERITAGE" has no mapping',
        'area_codes mixes UK-wide codes with other areas: E12000001, K02000001'
      ]
    }
  ])
  assert.deepEqual(conversion.ignoredColumns, ['colour_code'])

  assert.equal(report('tpx-workbook.xlsx', conversion), [
    'tpx-workbook.xlsx: 6 rows, 3 can be imported, 3 cannot.',
    '',
    'example_duplicated_loan (Loans sheet, row 3)',
    '- scheme_id is also used on Loans row 4',
    '',
    'example_duplicated_loan (Loans sheet, row 4)',
    '- scheme_id is also used on Loans row 3',
    '',
    'example_broken_grant (Grants sheet, row 3)',
    '- source_url must be a web address starting https://, not http://www.example.com/broken',
    '- closing_date must be a date or ROLLING, not "Opens late 2026"',
    '- sectors "Space Tourism" is not on our list and has no mapping',
    '- support_goals "HERITAGE" has no mapping',
    '- area_codes mixes UK-wide codes with other areas: E12000001, K02000001',
    '',
    'Columns that are not imported: colour_code'
  ].join('\n'))
})

test('other problems in a row are reported', () => {
  const problems = (sheet: string, values: Record<string, Cell>): string[] => convertWorkbook(oneRow(sheet, values), lists).rejected[0]?.problems ?? []

  assert.deepEqual(problems('Loans', {}), [])
  assert.deepEqual(problems('Loans', { help_type: 'GRANT' }), ['help_type is GRANT, but the scheme is on the Loans sheet'])
  assert.deepEqual(problems('Loans', { verified_date: null, status: null }), ['status is missing', 'verified_date is missing'])
  assert.deepEqual(problems('Loans', { status: 'closed' }), ['status "closed" is not on our list and has no mapping'])
  assert.deepEqual(problems('Loans', { min_amount: 500, max_amount: 100 }), ['min_amount 500 is more than max_amount 100'])
  assert.deepEqual(problems('Loans', { review_by_date: new Date('2026-01-01') }), ['review_by_date 2026-01-01 is before verified_date 2026-09-09'])
  assert.deepEqual(problems('Loans', { support_goals: 'SOCIAL_IMPACT' }), ['support_goals SOCIAL_IMPACT have no matching purposes, so the scheme would look open to every purpose'])
  assert.deepEqual(problems('Loans', { stage: 'early_stage' }), ['stage "early_stage" is not on our list and has no mapping'])
  assert.deepEqual(problems('Loans', { sectors: 'any | Manufacturing' }), ['sectors lists "any" with other values'])
  assert.deepEqual(problems('Loans', { area_level: 'regional', area_codes: null }), ['area_codes is empty for a regional'])
  // Cumbria County Council, replaced in 2023.
  assert.deepEqual(problems('Loans', { area_level: 'local', area_codes: 'E10000006' }), ['area_codes E10000006 is not a current ONS country, region, county or local authority code'])
  assert.deepEqual(problems('Grants', { match_funding_required: 'Conditional' }), ['match_funding_required must be Yes or No, not "Conditional"'])
  assert.deepEqual(problems('Grants', { match_funding_percentage: 120 }), ['match_funding_percentage must be a whole number from 0 to 100, not "120"'])
  assert.deepEqual(problems('Loans', { successor_id: 'no_such_scheme' }), ['successor_id no_such_scheme is not a scheme that can be imported'])
  assert.deepEqual(problems('Loans', { scheme_id: 'Test Scheme' }), ['scheme_id must use lower case letters and numbers, joined by underscores'])
})

test('Great Britain, and England and Wales, are held as their countries', () => {
  const areas = (code: string): string[] => convertWorkbook(oneRow('Loans', { area_codes: code }), lists).records[0].areas

  assert.deepEqual(areas('K03000001'), ['E92000001', 'S92000003', 'W92000004'])
  assert.deepEqual(areas('K04000001'), ['E92000001', 'W92000004'])
})

test('every value the mappings use is on our lists', () => {
  const check = (name: string, values: string[], allowed: Set<string>): void => {
    const missing = values.filter((value) => !allowed.has(value))
    assert.deepEqual(missing, [], `${name} mapping uses values that are not on our list`)
  }

  check('Goals', Object.values(GOALS).flat(), lists.purposes)
  check('Sectors', Object.values(SECTORS).flat(), new Set(lists.sectors.values()))
  check('Business stages', Object.values(BUSINESS_STAGES), lists.businessStages)
  check('Statuses', Object.values(STATUSES), lists.statuses)
  check('Spend types', Object.values(SPEND_TYPES).flat(), lists.spendTypes)
  check('Areas', Object.values(UK_WIDE_AREAS).flat(), lists.areas)
  check('Support speeds', Object.values(SUPPORT_SPEEDS), new Set(['less-than-1-month', '1-to-3-months', '4-to-6-months', 'over-6-months']))
})

test('the imported schemes are published in the API format, with a county published as its districts', async () => {
  const { conversion, removed } = await importWorkbook(db.pool, WORKBOOK)
  assert.equal(conversion.records.length, 3)
  assert.deepEqual(removed, [])

  const { example, schemes } = await postgresStore(db.pool).list({ types: [], sectors: [], purposes: [] })
  const ajv = new Ajv2020({ strict: false, validateFormats: false, allErrors: true })
  ajv.addSchema({ $id: 'openapi', ...openApi })
  const validate = ajv.getSchema('openapi#/components/schemas/SchemeList')
  assert.ok(validate?.({ example, count: schemes.length, schemes }), ajv.errorsText(validate?.errors))
  assert.equal(example, false)

  const county = schemes.find((scheme) => scheme.id === 'example_county_grant')
  assert.deepEqual(county?.areas, { localAuthorities: ['E07000032', 'E07000033', 'E07000034', 'E07000035', 'E07000036', 'E07000037', 'E07000038', 'E07000039'] })

  const { rows } = await db.pool.query("select status, support_speed, match_funding_percent, checked_by from schemes where id = 'example_county_grant'")
  assert.deepEqual(rows[0], { status: 'open', support_speed: '4-to-6-months', match_funding_percent: 50, checked_by: 'Tester' })
})

test('checking the workbook does not change the database', async () => {
  const before = (await db.pool.query('select id from schemes order by id')).rows
  const { conversion } = await importWorkbook(db.pool, WORKBOOK, { check: true })

  assert.equal(conversion.rejected.length, 3)
  assert.deepEqual((await db.pool.query('select id from schemes order by id')).rows, before)
})
