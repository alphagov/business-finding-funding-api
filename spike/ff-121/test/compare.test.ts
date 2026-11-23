import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import type { Entry } from '../entry'
import { addressKey, matchScheme, nameScore, publishedForNorthEast, readDiscovered, readTeamList, sameName, sharedAddresses, withDiscovery, type Scheme } from '../compare'

// Made-up schemes and entries, in the shape of the team's list and the
// collected sources.

function scheme (name: string, link: string, more: Partial<Scheme> = {}): Scheme {
  return { list: 'Master list', id: 'S001', name, category: 'Grant', provider: 'Made-up Council', link, grant: true, ...more }
}

function entry (source: Entry['source'], id: string, name: string, page: string, more: Partial<Entry> = {}): Entry {
  return { source, id, name, page, read: 'page', provider: null, providerPage: null, applyPage: null, updated: null, fields: {}, text: '', fingerprint: null, ...more }
}

test('addresses: compared without www, query or final slash, and home pages are not used', () => {
  assert.equal(addressKey('https://www.Example.org/Grants/Shop-Front/?utm=1#top'), 'example.org/grants/shop-front')
  assert.equal(addressKey('https://www.example.org/'), null)
  assert.equal(addressKey('mailto:help@example.org'), null)
  assert.equal(addressKey('not an address'), null)
  assert.equal(addressKey(null), null)
})

test('names: alike when they share a word that is not generic', () => {
  assert.ok(sameName('Growth Guarantee Scheme (GGS)', 'Growth Guarantee Scheme'))
  assert.ok(sameName('Woodland Creation Planning Grant (WCPG)', 'Trees, woodlands and forestry - Woodland Creation Planning Grant'))
  assert.ok(sameName('Transferable AV Equipment for Rail Replacement Coaches', 'Transferable Audio-Visual Equipment on Rail Replacement Coaches'))
  assert.ok(sameName('Local Women, Local Enterprise', 'Local Women Local Enterprise'))

  assert.ok(!sameName('North East Elevate Fund', 'The North East Fund'), 'only generic words are shared')
  assert.ok(!sameName('North East Business Grant', 'North East Business Loans'))
  assert.ok(!sameName('Shop Front Grant', 'Energy Efficiency Grant'))

  assert.ok(nameScore('ATI SME Programme', 'ATI SME Programme') > nameScore('ATI SME Programme', 'ATI SME Programme for Aerospace Firms'))
})

test('matching: by address first, then the closest name, and not on shared addresses', () => {
  const entries = [
    entry('govuk-finder', 'ati', 'Aerospace Technology Institute (ATI)', 'https://www.gov.uk/business-finance-support/ati'),
    entry('govuk-finder', 'ati-sme', 'Aerospace Technology Institute (ATI) SME Programme', 'https://www.gov.uk/business-finance-support/ati-sme'),
    entry('north-east-growth-hub', 'shop', 'Shop Front Scheme', 'https://growthhub.example.org/resource/shop'),
    entry('tees-valley', 'mercia', 'Mercia Capital', 'https://tv.example.org/mercia', { providerPage: 'https://mercia.example.org/fund/' })
  ]

  assert.deepEqual(matchScheme(scheme('Aerospace Technology Institute (ATI) SME Programme', ''), entries), [{ source: 'govuk-finder', entry: 'ati-sme', by: 'name' }])
  assert.deepEqual(matchScheme(scheme('A different name', 'https://growthhub.example.org/resource/shop/'), entries), [{ source: 'north-east-growth-hub', entry: 'shop', by: 'address' }])
  assert.deepEqual(matchScheme(scheme('Equity finance', 'https://mercia.example.org/fund'), entries), [{ source: 'tees-valley', entry: 'mercia', by: 'address' }])

  const list = [scheme('One', 'https://growthhub.example.org/business-support'), scheme('Two', 'https://growthhub.example.org/business-support/'), scheme('Three', 'https://growthhub.example.org/resource/shop')]
  const shared = sharedAddresses(list)
  assert.deepEqual([...shared], ['growthhub.example.org/business-support'])
  const listPage = [entry('north-east-growth-hub', 'list', 'Business support', 'https://growthhub.example.org/business-support')]
  assert.deepEqual(matchScheme(list[0], listPage, shared), [])
})

test('the API\'s schemes a North East business could use', () => {
  const rows = [
    { values: { scheme_id: 'a', scheme_name: 'National loan', area_level: 'national', area_codes: 'K02000001', help_type: 'LOAN' } },
    { values: { scheme_id: 'b', scheme_name: 'Gateshead grant', area_level: 'local', area_codes: 'E08000037', help_type: 'GRANT' } },
    { values: { scheme_id: 'c', scheme_name: 'England grant', area_level: 'national', area_codes: 'E92000001', help_type: 'GRANT' } },
    { values: { scheme_id: 'd', scheme_name: 'Birmingham grant', area_level: 'local', area_codes: 'E08000025', help_type: 'GRANT' } }
  ]
  const kept = publishedForNorthEast(rows)
  assert.deepEqual(kept.map((one) => [one.id, one.grant]), [['a', false], ['b', true], ['c', true]])
})

test('TPX\'s candidates: read from its discovery file and counted with the sources', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-121-'))
  const file = path.join(folder, 'candidates.json')
  fs.writeFileSync(file, JSON.stringify({
    candidates: [
      { id: 'blind:shop', name: 'Shop Front Scheme', running_body: 'Made-up Council', kind: 'grant', area: 'Gateshead', addresses: ['https://council.example.org/shop'], best: { address: 'https://council.example.org/shop', fetch_status: 200 } },
      { id: 'blind:export', name: 'Export Credit Guarantee', kind: 'guarantee', addresses: [], best: { address: 'https://export.example.org/credit', fetch_status: 404 } }
    ]
  }))
  const discovered = readDiscovered(file)
  assert.deepEqual(discovered.map((one) => [one.id, one.link, one.worked]), [
    ['blind:shop', 'https://council.example.org/shop', true],
    ['blind:export', 'https://export.example.org/credit', false]
  ])
  assert.throws(() => readDiscovered(path.join(__dirname, '..', '..', '..', 'package.json')), /no candidates/)

  const team = [
    scheme('Shop Front Scheme', 'https://council.example.org/shop'),
    scheme('Export Credit Guarantee', '', { grant: false }),
    scheme('Mentoring Programme', '', { grant: false })
  ]
  const entries = [entry('north-east-growth-hub', 'shop', 'Shop Front Scheme', 'https://growthhub.example.org/resource/shop')]
  const lines = withDiscovery(team, discovered, entries)
  // Schemes, four sources, TPX's search, either, both, sources only, search only, neither.
  assert.ok(lines.includes('| All schemes | 3 | 1 | 2 | 2 | 1 | 0 | 1 | 1 |'))
  assert.ok(lines.includes('| All | 2 | 1 (50%) | 1 (50%) |'))
})

test('the team\'s list is refused when it is inside the repository', async () => {
  const inside = path.join(__dirname, '..', '..', '..', 'data', 'list.xlsx')
  await assert.rejects(readTeamList(inside), /outside this repository/)
})
