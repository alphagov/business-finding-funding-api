import type pg from 'pg'
import { loadConfig } from './config'
import { createPool } from './db'
import { loadFunding, type FundingData, type Scheme } from './schemes'

// Loads the funding schemes from data/funding-schemes.json into the
// database, so the database matches the file: schemes are added or
// updated, and schemes no longer in the file are removed.
//
// The file is checked first, and everything is loaded in one transaction,
// so if anything is wrong nothing changes.
//
// Heroku runs this on every release (see Procfile), because the file is the
// master copy for now and is changed by pull request.

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

async function saveScheme (client: pg.PoolClient, scheme: Scheme, example: boolean, areas: string[]): Promise<void> {
  const { id } = scheme

  await client.query(`
    insert into schemes (id, type, name, provider, summary, url, checked_on, amount_min, amount_max, closes_on, match_funding_required, decision_time, example)
    values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    on conflict (id) do update set
      type = excluded.type, name = excluded.name, provider = excluded.provider, summary = excluded.summary, url = excluded.url,
      checked_on = excluded.checked_on, amount_min = excluded.amount_min, amount_max = excluded.amount_max, closes_on = excluded.closes_on,
      match_funding_required = excluded.match_funding_required, decision_time = excluded.decision_time, example = excluded.example`,
  [id, scheme.type, scheme.name, scheme.provider, scheme.summary, scheme.url, scheme.checkedOn, scheme.amount?.min ?? null,
    scheme.amount?.max ?? null, scheme.closesOn ?? null, scheme.matchFundingRequired ?? null, scheme.decisionTime ?? null, example])

  // Replace the scheme's details and lists with the ones in the file.
  for (const table of ['loan_details', 'grant_details', 'equity_details', 'scheme_sectors', 'scheme_purposes', 'scheme_areas', 'scheme_eligibility']) {
    await client.query(`delete from ${table} where scheme_id = $1`, [id])
  }

  if (scheme.type === 'loan') {
    await client.query('insert into loan_details (scheme_id, interest_rate, repayment_term, fees) values ($1, $2, $3, $4)',
      [id, scheme.interestRate ?? null, scheme.repaymentTerm ?? null, scheme.fees ?? null])
  } else if (scheme.type === 'grant') {
    await client.query('insert into grant_details (scheme_id, contribution) values ($1, $2)', [id, scheme.contribution ?? null])
  } else {
    await client.query('insert into equity_details (scheme_id, investment_type) values ($1, $2)', [id, scheme.investmentType ?? null])
  }

  await client.query('insert into scheme_sectors (scheme_id, sector) select $1, unnest($2::text[])', [id, scheme.sectors ?? []])
  await client.query('insert into scheme_purposes (scheme_id, purpose) select $1, unnest($2::text[])', [id, scheme.purposes ?? []])
  await client.query('insert into scheme_areas (scheme_id, area_code) select $1, unnest($2::text[])', [id, areas])
  await client.query(`
    insert into scheme_eligibility (scheme_id, position, criterion)
    select $1, position, criterion from unnest($2::text[]) with ordinality as list (criterion, position)`,
  [id, scheme.eligibility])
}

export async function loadSchemes (pool: pg.Pool, { example, schemes }: FundingData): Promise<LoadResult> {
  const client = await pool.connect()

  try {
    const { rows } = await client.query<{ code: string, name: string, level: string }>("select code, name, level from areas where level in ('country', 'region')")
    const byName: AreaCodes = new Map(rows.map((row) => [`${row.level}:${row.name}`, row.code]))

    const areas = new Map(schemes.map((scheme) => [scheme.id, areaCodes(scheme, byName)]))
    const problems = [...schemes.flatMap(typeProblems), ...[...areas.values()].flatMap((result) => result.problems)]
    if (problems.length) throw new Error(`Problems with the funding data:\n${problems.join('\n')}`)

    await client.query('begin')

    for (const scheme of schemes) {
      try {
        await saveScheme(client, scheme, example, areas.get(scheme.id)?.codes ?? [])
      } catch (err) {
        // For example, a sector that is not on the list.
        const { message, detail } = err as { message: string, detail?: string }
        throw new Error(`Problems with the funding data:\n${scheme.id}: ${detail ?? message}`)
      }
    }

    const removed = await client.query<{ id: string }>('delete from schemes where not (id = any($1::text[])) returning id', [schemes.map((scheme) => scheme.id)])
    await client.query('commit')

    return { loaded: schemes.length, removed: removed.rows.map((row) => row.id).sort() }
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
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
