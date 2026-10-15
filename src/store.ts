import type pg from 'pg'
import type { FundingType, Scheme } from './schemes'

// Reads the funding schemes from the database, in the format the API
// publishes (the Scheme schema in src/openapi.ts).

export interface Filters {
  types: FundingType[]
  sectors: string[]
  purposes: string[]
}

export interface SchemeList {
  // True if any scheme in the list is made up for testing.
  example: boolean
  schemes: Scheme[]
}

export interface SchemeStore {
  list: (filters: Filters) => Promise<SchemeList>
  get: (id: string) => Promise<Scheme | undefined>
  // Throws an error if the database cannot be reached.
  check: () => Promise<void>
}

// Builds one scheme as JSON. Fields with no value are left out, as they are
// in the data file.
const SCHEME_JSON = `
  json_strip_nulls(json_build_object(
    'id', s.id,
    'type', s.type,
    'name', s.name,
    'provider', s.provider,
    'summary', s.summary,
    'url', s.url,
    'checkedOn', s.checked_on,
    'areas', (
      select json_build_object(
        'countries', json_agg(a.name order by a.name) filter (where a.level = 'country'),
        'regions', json_agg(a.name order by a.name) filter (where a.level = 'region'),
        'localAuthorities', json_agg(a.code order by a.code) filter (where a.level = 'local-authority')
      )
      from scheme_areas sa join areas a on a.code = sa.area_code
      where sa.scheme_id = s.id
      having count(*) > 0
    ),
    'amount', case when s.amount_min is not null or s.amount_max is not null
      then json_build_object('min', s.amount_min, 'max', s.amount_max) end,
    'sectors', (select json_agg(sector order by sector) from scheme_sectors where scheme_id = s.id),
    'purposes', (select json_agg(purpose order by purpose) from scheme_purposes where scheme_id = s.id),
    'closesOn', s.closes_on,
    'matchFundingRequired', s.match_funding_required,
    'interestRate', l.interest_rate,
    'repaymentTerm', l.repayment_term,
    'fees', l.fees,
    'contribution', g.contribution,
    'decisionTime', s.decision_time,
    'investmentType', e.investment_type,
    'eligibility', coalesce((select json_agg(criterion order by position) from scheme_eligibility where scheme_id = s.id), '[]')
  ))`

const FROM_SCHEMES = `
  from schemes s
  left join loan_details l on l.scheme_id = s.id
  left join grant_details g on g.scheme_id = s.id
  left join equity_details e on e.scheme_id = s.id`

// A scheme matches a filter if it has any of the values, or if its list is
// empty because it is open to all.
const matchesAny = (table: string, column: string, param: string): string => `(
  cardinality(${param}::text[]) = 0
  or not exists (select 1 from ${table} where scheme_id = s.id)
  or exists (select 1 from ${table} where scheme_id = s.id and ${column} = any(${param}::text[]))
)`

const LIST_SQL = `
  select ${SCHEME_JSON} as scheme, s.example
  ${FROM_SCHEMES}
  where (cardinality($1::text[]) = 0 or s.type = any($1::text[]))
    and ${matchesAny('scheme_sectors', 'sector', '$2')}
    and ${matchesAny('scheme_purposes', 'purpose', '$3')}
  order by s.name, s.id`

const GET_SQL = `
  select ${SCHEME_JSON} as scheme
  ${FROM_SCHEMES}
  where s.id = $1`

export function postgresStore (pool: pg.Pool): SchemeStore {
  return {
    async list ({ types, sectors, purposes }) {
      const { rows } = await pool.query<{ scheme: Scheme, example: boolean }>(LIST_SQL, [types, sectors, purposes])
      return { example: rows.some((row) => row.example), schemes: rows.map((row) => row.scheme) }
    },

    async get (id) {
      const { rows } = await pool.query<{ scheme: Scheme }>(GET_SQL, [id])
      return rows[0]?.scheme
    },

    async check () {
      await pool.query('select 1')
    }
  }
}
