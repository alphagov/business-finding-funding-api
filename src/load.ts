import type pg from 'pg'
import { loadConfig } from './config'
import { createPool } from './db'
import { saveSchemes, type SchemeRecord } from './records'
import { loadFunding, type FundingData, type Scheme } from './schemes'

// Loads the made-up schemes from data/example-schemes.json into the
// database, so the database matches the file: schemes are added or
// updated, and schemes no longer in the file are removed. The tests use
// it, and `npm run db:examples` runs it locally. The live API imports the
// One Platform schema workbook instead (see src/tpx/).
//
// The file is checked first, and everything is loaded in one transaction,
// so if anything is wrong nothing changes.

// Fields the file allows on any scheme, but the database only holds for
// one type of funding.
const TYPE_ONLY: Record<string, Array<keyof Scheme>> = {
  loan: ['interestRate', 'repaymentTerm', 'fees'],
  grant: ['contribution'],
  equity: ['investmentType']
}

export interface LoadResult {
  loaded: number
  removed: string[]
}

type AreaCodes = Map<string, string>

// Countries and regions are named in the file, and local authorities use
// their codes. Returns the codes, or the names that are not recognised.
function areaCodes (scheme: Scheme, byName: AreaCodes): { codes: string[], problems: string[] } {
  const { countries = [], regions = [], localAuthorities = [] } = scheme.areas ?? {}
  const problems: string[] = []
  const codes: string[] = []

  for (const [level, names] of [['country', countries], ['region', regions]] as const) {
    for (const name of names) {
      const code = byName.get(`${level}:${name}`)
      if (code) codes.push(code)
      else problems.push(`${scheme.id}: there is no ${level} called ${name}`)
    }
  }

  return { codes: [...codes, ...localAuthorities], problems }
}

function typeProblems (scheme: Scheme): string[] {
  return Object.entries(TYPE_ONLY)
    .filter(([type]) => type !== scheme.type)
    .flatMap(([type, fields]) => fields.filter((field) => scheme[field] !== undefined).map((field) => `${scheme.id}: ${field} is only for ${type} schemes`))
}

function toRecord (scheme: Scheme, example: boolean, areas: string[]): SchemeRecord {
  return {
    id: scheme.id,
    type: scheme.type,
    name: scheme.name,
    provider: scheme.provider,
    summary: scheme.summary,
    url: scheme.url,
    status: 'open',
    amountMin: scheme.amount?.min,
    amountMax: scheme.amount?.max,
    matchFundingRequired: scheme.matchFundingRequired,
    closesOn: scheme.closesOn,
    decisionTime: scheme.decisionTime,
    checkedOn: scheme.checkedOn,
    example,
    loan: { interestRate: scheme.interestRate, repaymentTerm: scheme.repaymentTerm, fees: scheme.fees },
    grant: { contribution: scheme.contribution },
    equity: { investmentType: scheme.investmentType },
    sectors: scheme.sectors ?? [],
    purposes: scheme.purposes ?? [],
    areas,
    businessStages: [],
    legalStructures: [],
    spendTypes: [],
    eligibility: scheme.eligibility
  }
}

export async function loadSchemes (pool: pg.Pool, { example, schemes }: FundingData): Promise<LoadResult> {
  const { rows } = await pool.query<{ code: string, name: string, level: string }>("select code, name, level from areas where level in ('country', 'region')")
  const byName: AreaCodes = new Map(rows.map((row) => [`${row.level}:${row.name}`, row.code]))

  const areas = new Map(schemes.map((scheme) => [scheme.id, areaCodes(scheme, byName)]))
  const problems = [...schemes.flatMap(typeProblems), ...[...areas.values()].flatMap((result) => result.problems)]
  if (problems.length) throw new Error(`Problems with the funding data:\n${problems.join('\n')}`)

  const { saved, removed } = await saveSchemes(pool, schemes.map((scheme) => toRecord(scheme, example, areas.get(scheme.id)?.codes ?? [])))
  return { loaded: saved, removed }
}

if (require.main === module) {
  const pool = createPool(loadConfig())

  loadSchemes(pool, loadFunding())
    .then(({ loaded, removed }) => {
      console.log(`Loaded ${loaded} funding schemes${removed.length ? `, and removed ${removed.join(', ')}` : ''}`)
    })
    .catch((err) => {
      console.error(err.message)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
