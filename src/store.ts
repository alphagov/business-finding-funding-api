import type pg from 'pg'
import type { FundingType, PublishedScheme } from './schemes'

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
  schemes: PublishedScheme[]
}

export interface SchemeStore {
  list: (filters: Filters) => Promise<SchemeList>
  get: (id: string) => Promise<PublishedScheme | undefined>
  // Throws an error if the database cannot be reached.
  check: () => Promise<void>
}

const areaNames = (level: string): string => `
  select json_agg(a.name order by a.name) from scheme_areas sa join areas a on a.code = sa.area_code
  where sa.scheme_id = s.id and a.level = '${level}'`

// Builds one scheme as JSON. Fields with no value are left out, as they are
// in the data file.
const SCHEME_JSON = `
  json_strip_nulls(json_build_object(
    'id', s.id,
    'type', s.type,
    'name', s.name,
    'provider', s.provider,
    'summary', s.summary,
    'whoCanApply', s.who_can_apply,
    'url', s.url,
    'applicationUrl', s.application_url,
    'status', s.status,
    'statusCheckedOn', s.status_checked_on,
    'replacedBy', s.replaced_by,
    'nextRound', s.next_round,
    'checkedOn', s.checked_on,
    'reviewBy', s.review_by,
    'areas', case when exists (select 1 from scheme_areas where scheme_id = s.id) then json_build_object(
      'countries', (${areaNames('country')}),
      'regions', (${areaNames('region')}),
      -- A county is published as the districts in it.
      'localAuthorities', (
        select json_agg(code order by code) from (
          select sa.area_code as code from scheme_areas sa join areas a on a.code = sa.area_code
          where sa.scheme_id = s.id and a.level = 'local-authority'
          union
          select cd.district_code from scheme_areas sa join county_districts cd on cd.county_code = sa.area_code
          where sa.scheme_id = s.id
        ) as codes
      )
    ) end,
    'amount', case when s.amount_min is not null or s.amount_max is not null
      then json_build_object('min', s.amount_min, 'max', s.amount_max) end,
    'sectors', (select json_agg(sector order by sector) from scheme_sectors where scheme_id = s.id),
    'purposes', (select json_agg(purpose order by purpose) from scheme_purposes where scheme_id = s.id),
    'businessStages', (select json_agg(business_stage order by business_stage) from scheme_business_stages where scheme_id = s.id),
    'legalStructures', (select json_agg(legal_structure order by legal_structure) from scheme_legal_structures where scheme_id = s.id),
    'spendTypes', (select json_agg(spend_type order by spend_type) from scheme_spend_types where scheme_id = s.id),
    'closesOn', s.closes_on,
    'supportSpeed', s.support_speed,
    'decisionTime', s.decision_time,
    'matchFundingRequired', s.match_funding_required,
    'matchFundingPercent', s.match_funding_percent,
    'premisesRequired', s.premises_required,
    'premisesTenure', s.premises_tenure,
    'interestRate', l.interest_rate,
    'repaymentTerm', l.repayment_term,
    'fees', l.fees,
    'contribution', g.contribution,
    'paidInArrears', g.paid_in_arrears,
    'subsidyControlApplies', g.subsidy_control_applies,
    'investmentType', e.investment_type,
    'ownershipExchangeRequired', e.ownership_exchange_required,
    'followOnInvestmentAvailable', e.follow_on_investment_available,
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
      const { rows } = await pool.query<{ scheme: PublishedScheme, example: boolean }>(LIST_SQL, [types, sectors, purposes])
      return { example: rows.some((row) => row.example), schemes: rows.map((row) => row.scheme) }
    },

    async get (id) {
      const { rows } = await pool.query<{ scheme: PublishedScheme }>(GET_SQL, [id])
      return rows[0]?.scheme
    },

    async check () {
      await pool.query('select 1')
    }
  }
}
