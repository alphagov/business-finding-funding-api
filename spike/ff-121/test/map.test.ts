import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import type { Entry, SourceName, Value } from '../entry'
import { amountsFrom, coverage, isFunding, mapEntry } from '../map'
import * as mapping from '../mapping'

// Made-up entries, one field at a time.
function entry (source: SourceName, fields: Record<string, Value>, more: Partial<Entry> = {}): Entry {
  return {
    source,
    id: 'made-up',
    name: 'Made-up scheme',
    page: 'https://www.example.org/made-up',
    read: 'page',
    provider: null,
    providerPage: null,
    applyPage: null,
    updated: null,
    fields,
    text: '',
    fingerprint: null,
    ...more
  }
}

const READ_ON = '2026-11-20'

test('the tables only use codes on the API\'s fixed lists and ONS areas', () => {
  const migrations = path.join(__dirname, '..', '..', '..', 'migrations')
  const lists = fs.readFileSync(path.join(migrations, '002-add-list-values.sql'), 'utf8')
  const areas = fs.readFileSync(path.join(migrations, '003-add-ons-areas.sql'), 'utf8')
  const listCodes = new Set([...lists.matchAll(/\('([a-z0-9-]+)',/g)].map((match) => match[1]))
  const areaCodes = new Set([...areas.matchAll(/\('([A-Z][0-9]{8})',/g)].map((match) => match[1]))

  const codes = [mapping.GOVUK_STAGES, mapping.GROWTH_HUB_STAGES, mapping.TEES_VALLEY_STAGES, mapping.GOVUK_INDUSTRIES, mapping.TEES_VALLEY_SECTORS]
    .flatMap((table) => Object.values(table).flat())
  for (const code of [...codes, ...Object.values(mapping.FUNDING_TYPES)]) assert.ok(listCodes.has(code), `${code} is on a fixed list`)
  for (const kinds of Object.values(mapping.FIND_A_GRANT_APPLICANTS)) {
    if (Array.isArray(kinds)) for (const code of kinds) assert.ok(listCodes.has(code), `${code} is a legal structure`)
  }

  const areaValues = [...Object.values(mapping.REGIONS), ...Object.values(mapping.NORTH_EAST_COUNCILS), ...Object.values(mapping.FIND_A_GRANT_LOCATIONS).flat(), mapping.ENGLAND]
  for (const code of areaValues) assert.ok(areaCodes.has(code), `${code} is an ONS area`)
  assert.equal(Object.keys(mapping.NORTH_EAST_COUNCILS).length, 12)
})

test('amounts from labelled values', () => {
  assert.deepEqual(amountsFrom('£5,000 – £35,000'), { min: 5000, max: 35000 })
  assert.deepEqual(amountsFrom('Up to £1.5m'), { min: null, max: 1500000 })
  assert.deepEqual(amountsFrom('£10k'), { min: 10000, max: 10000 })
  assert.equal(amountsFrom('Rolling'), null)
})

test('GOV.UK: every region is the whole UK, every industry is any sector, and the stages map', () => {
  const allRegions = Object.keys(mapping.REGIONS)
  const allIndustries = Object.keys(mapping.GOVUK_INDUSTRIES)
  const mapped = mapEntry(entry('govuk-finder', {
    regions: allRegions,
    industries: allIndustries,
    business_stages: ['start-up'],
    types_of_support: ['grant', 'expertise-and-advice'],
    description: 'Grants for shops.'
  }, { providerPage: 'https://www.example.org/grant', text: 'Up to £5,000. Apply by 3 March.' }), READ_ON)

  assert.deepEqual(mapped.fields.areas, { how: 'coded', value: [] })
  assert.deepEqual(mapped.fields.sectors, { how: 'coded', value: [] })
  assert.deepEqual(mapped.fields.business_stages, { how: 'coded', value: ['first-year'] })
  assert.deepEqual(mapped.fields.type, { how: 'coded', value: ['grant'] })
  assert.equal(mapped.grant, true)
  assert.equal(mapped.fields.provider.how, 'text')
  assert.equal(mapped.fields.amounts.how, 'text')
  assert.equal(mapped.fields.closes_on.how, 'text')
  assert.equal(mapped.fields.match_funding.how, 'none')
  assert.equal(mapped.fields.application_url.how, 'none')

  const england = mapEntry(entry('govuk-finder', { regions: allRegions.filter((region) => mapping.REGIONS[region].startsWith('E12')) }), READ_ON)
  assert.deepEqual(england.fields.areas.value, [mapping.ENGLAND])
})

test('Find a Grant: status from the dates, areas from locations, private sector open to all', () => {
  const fields = { location: ['North East England', 'Midlands'], applicant_types: ['Private Sector', 'Non-profit'], opening_date: '2027-01-05T00:00', closing_date: '2027-03-01T17:00', minimum_award: 300, maximum_award: 50000 }
  const mapped = mapEntry(entry('find-a-grant', fields, { provider: 'Made-up Office', applyPage: 'https://apply.example.org/' }), READ_ON)

  assert.deepEqual(mapped.fields.status, { how: 'coded', value: 'pre-launch' })
  assert.deepEqual(mapped.fields.areas, { how: 'coded', value: ['E12000001', 'E12000004', 'E12000005'] })
  assert.deepEqual(mapped.fields.legal_structures, { how: 'coded', value: [] })
  assert.deepEqual(mapped.fields.closes_on, { how: 'coded', value: '2027-03-01' })
  assert.deepEqual(mapped.fields.amounts, { how: 'coded', value: ['300', '50000'] })
  assert.equal(mapped.fields.url.how, 'none')

  const national = mapEntry(entry('find-a-grant', { location: ['National', 'Wales'], applicant_types: ['Non-profit'] }), READ_ON)
  assert.deepEqual(national.fields.areas.value, [])
  assert.deepEqual(national.fields.legal_structures.value, ['charity', 'cic'])
})

test('Growth Hub: council areas, stages from one labelled value, type from categories', () => {
  const mapped = mapEntry(entry('north-east-growth-hub', {
    area: ['Gateshead', 'Sunderland', 'Atlantis'],
    business_stage: 'Start-up, Trading business',
    categories: ['Finance & funding', 'Grant'],
    grant_size: 'Up to £25,000',
    status: 'Open',
    summary: 'Grants for growing firms'
  }), READ_ON)

  assert.deepEqual(mapped.fields.areas, { how: 'coded', value: ['E08000037', 'E08000024'], unmapped: ['Atlantis'] })
  assert.deepEqual(mapped.fields.business_stages, { how: 'coded', value: [] })
  assert.deepEqual(mapped.fields.amounts, { how: 'coded', value: ['', '25000'] })
  assert.equal(mapped.grant, true)
  assert.equal(mapped.fields.sectors.how, 'none')
})

test('Tees Valley: "Social Enterprise" and "Export" are passed over, and grants come from the text', () => {
  const mapped = mapEntry(entry('tees-valley', {
    location: ['Darlington'],
    business_stage: ['Social Enterprise', 'Start-Up'],
    sector: ['Digital & Tech', 'Export'],
    help_categories: ['Accessing Finance & Funding']
  }, { text: 'Grants of up to £2,000 for sole traders.' }), READ_ON)

  assert.deepEqual(mapped.fields.business_stages, { how: 'coded', value: ['pre-start', 'first-year'] })
  assert.deepEqual(mapped.fields.sectors, { how: 'coded', value: ['technology'] })
  assert.equal(mapped.grant, true)
  assert.equal(mapped.grantFrom, 'text')
  assert.equal(mapped.fields.type.how, 'text')
  assert.equal(mapped.fields.legal_structures.how, 'text')
  assert.ok(isFunding(entry('tees-valley', { help_categories: ['Accessing Finance & Funding'] })))
  assert.ok(!isFunding(entry('tees-valley', { help_categories: ['Networking'] })))

  const counts = coverage([mapped])
  assert.deepEqual(counts.sectors, { coded: 1, text: 0, none: 0 })
  assert.deepEqual(counts.status, { coded: 0, text: 0, none: 1 })
})
