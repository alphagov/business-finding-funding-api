import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Entry, SourceName, Value } from '../entry'
import { checklistCsv, checkRows, govukAreas, sample, sourceSays } from '../checklist'
import { REGIONS } from '../mapping'

function entry (source: SourceName, id: string, fields: Record<string, Value>, more: Partial<Entry> = {}): Entry {
  return { source, id, name: `Made-up ${id}`, page: `https://source.example.org/${id}`, read: 'page', provider: null, providerPage: null, applyPage: null, updated: null, fields, text: '', fingerprint: null, ...more }
}

test('the sample is the same each time, grants first, funding only', () => {
  const entries = [
    ...Array.from({ length: 12 }, (_, at) => entry('govuk-finder', `grant-${at}`, { types_of_support: ['grant'] })),
    entry('govuk-finder', 'loan', { types_of_support: ['loan'] }),
    entry('govuk-finder', 'advice', { types_of_support: ['expertise-and-advice'] })
  ]
  const once = sample(entries).map((one) => one.id)
  assert.deepEqual(sample([...entries].reverse()).map((one) => one.id), once)
  assert.equal(once.length, 10)
  assert.ok(once.every((id) => id.startsWith('grant-')))

  const few = sample([entry('govuk-finder', 'g', { types_of_support: ['grant'] }), ...entries.slice(12)])
  assert.deepEqual(few.map((one) => one.id), ['g', 'loan'], 'topped up with other funding, never advice')
})

test('what the source says, in plain words', () => {
  const english = Object.keys(REGIONS).filter((region) => REGIONS[region].startsWith('E12'))
  assert.equal(govukAreas(Object.keys(REGIONS)), 'The whole UK')
  assert.equal(govukAreas([...english, 'wales']), 'England, Wales')
  assert.equal(govukAreas(['north-east', 'eastern']), 'North East, East of England')

  const grant = entry('find-a-grant', 'fund', { minimum_award: 300, maximum_award: 50000, opening_date: '2026-11-02T00:00', applicant_types: ['Private Sector'] })
  assert.equal(sourceSays(grant, 'amounts'), 'From £300 to £50,000')
  assert.equal(sourceSays(grant, 'status'), 'Listed as open (opens 2026-11-02)')
  assert.equal(sourceSays(entry('govuk-finder', 'g', { business_stages: ['not-yet-trading'] }), 'business_stages'), 'not yet trading')
})

test('a row for each value the source gives, and a CSV Excel can open', () => {
  const rows = checkRows([entry('tees-valley', 'fund', { location: ['Darlington'], business_stage: ['Start-Up'], sector: ['Digital & Tech'], help_categories: ['Accessing Finance & Funding'] }, { providerPage: 'https://fund.example.org/' })], '2026-11-20')
  assert.deepEqual(rows.map((row) => row.question), [
    'The running body\'s page is the scheme\'s own page and works',
    'The scheme is still running',
    'Where it is available',
    'Business stages it is for',
    'Sectors it is for'
  ])
  assert.equal(rows[0].runningBodyPage, 'https://fund.example.org/')

  // Find a Grant links only to the application, so the advert is checked.
  const [advert] = checkRows([entry('find-a-grant', 'grant', {}, { applyPage: 'https://apply.example.org/applications/1' })], '2026-11-20')
  assert.equal(advert.runningBodyPage, 'Application link only: use the advert on Find a Grant instead')
  assert.equal(advert.question, 'The advert on Find a Grant works and is about this scheme')
  assert.equal(advert.sourceSays, 'https://source.example.org/grant')

  const csv = checklistCsv([{ ...rows[0], scheme: 'A "quoted", name' }])
  assert.ok(csv.startsWith('﻿Check,Source,Scheme'))
  assert.ok(csv.includes('"A ""quoted"", name"'))
})
