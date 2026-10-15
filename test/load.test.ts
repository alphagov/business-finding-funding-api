import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { loadSchemes } from '../src/load'
import { loadFunding, type FundingData, type Scheme } from '../src/schemes'
import { postgresStore } from '../src/store'
import { testDatabase, type TestDatabase } from './helpers'

let db: TestDatabase

before(async () => {
  db = await testDatabase({ load: false })
})

after(async () => {
  await db.close()
})

// Lists whose order does not matter are compared sorted.
function sorted (scheme: Scheme): Scheme {
  const areas = scheme.areas && Object.fromEntries(Object.entries(scheme.areas).map(([level, list]) => [level, [...list].sort()]))
  return {
    ...scheme,
    ...(areas ? { areas } : {}),
    ...(scheme.sectors ? { sectors: [...scheme.sectors].sort() } : {}),
    ...(scheme.purposes ? { purposes: [...scheme.purposes].sort() } : {})
  }
}

async function published (): Promise<{ example: boolean, schemes: Scheme[] }> {
  const { example, schemes } = await postgresStore(db.pool).list({ types: [], sectors: [], purposes: [] })
  return { example, schemes: schemes.map(sorted).sort((a, b) => a.id.localeCompare(b.id)) }
}

function bySortedId (data: FundingData): { example: boolean, schemes: Scheme[] } {
  return { example: data.example, schemes: data.schemes.map(sorted).sort((a, b) => a.id.localeCompare(b.id)) }
}

test('the API publishes every scheme exactly as it is in the data file', async () => {
  const file = loadFunding()
  const result = await loadSchemes(db.pool, file)

  assert.deepEqual(result, { loaded: file.schemes.length, removed: [] })
  assert.deepEqual(await published(), bySortedId(file))
})

test('loading again updates changed schemes and removes schemes no longer in the file', async () => {
  const file = loadFunding()
  const [first, second, ...rest] = file.schemes
  const changed: FundingData = {
    example: true,
    schemes: [{ ...first, name: 'A new name', eligibility: ['Only one rule now'], sectors: ['construction'] }, ...rest]
  }

  const result = await loadSchemes(db.pool, changed)

  assert.deepEqual(result, { loaded: file.schemes.length - 1, removed: [second.id] })
  assert.deepEqual(await published(), bySortedId(changed))

  await loadSchemes(db.pool, file)
  assert.deepEqual(await published(), bySortedId(file))
})

test('a file with problems is not loaded, and nothing changes', async () => {
  const file = loadFunding()
  const before = await published()
  const [first, ...rest] = file.schemes
  const grant = file.schemes.find((scheme) => scheme.type === 'grant') as Scheme

  for (const [schemes, problem] of [
    [[...rest, { ...first, id: 'brand-new-scheme', sectors: ['creative-industries'] }], /brand-new-scheme: Key \(sector\)=\(creative-industries\) is not present in table "sectors"/],
    [[{ ...first, areas: { regions: ['North East England'] } }, ...rest], new RegExp(`${first.id}: there is no region called North East England`)],
    [[...rest.filter((scheme) => scheme.id !== grant.id), { ...grant, interestRate: '5%' }], new RegExp(`${grant.id}: interestRate is only for loan schemes`)]
  ] as Array<[Scheme[], RegExp]>) {
    await assert.rejects(loadSchemes(db.pool, { example: true, schemes }), problem)
    assert.deepEqual(await published(), before)
  }
})

test('the example flag comes from the data file', async () => {
  const file = loadFunding()

  await loadSchemes(db.pool, { ...file, example: false })
  assert.equal((await published()).example, false)

  await loadSchemes(db.pool, file)
  assert.equal((await published()).example, true)
})
