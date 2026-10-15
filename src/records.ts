import type pg from 'pg'
import type { FundingType } from './schemes'

// A scheme as the database holds it, with every field the tables have.
// The loaders (src/load.ts for the data file, src/tpx/ for the One Platform
// workbook) turn their input into these, then save them with saveSchemes.

export interface SchemeRecord {
  id: string
  type: FundingType
  name: string
  provider: string
  summary: string
  whoCanApply?: string
  url: string
  applicationUrl?: string
  status: string
  replacedBy?: string
  nextRound?: string
  sourceType?: string
  amountMin?: number
  amountMax?: number
  matchFundingRequired?: boolean
  matchFundingPercent?: number
  closesOn?: string
  supportSpeed?: string
  decisionTime?: string
  premisesRequired?: boolean
  premisesTenure?: string
  checkedOn: string
  checkedBy?: string
  statusCheckedOn?: string
  reviewBy?: string
  example: boolean
  loan?: { interestRate?: string, repaymentTerm?: string, fees?: string }
  grant?: { contribution?: string, paidInArrears?: boolean, subsidyControlApplies?: boolean }
  equity?: { investmentType?: string, ownershipExchangeRequired?: boolean, followOnInvestmentAvailable?: boolean }
  // Codes from the fixed lists. Empty when the scheme is open to all.
  sectors: string[]
  purposes: string[]
  // ONS codes. Empty for the whole of the UK.
  areas: string[]
  businessStages: string[]
  legalStructures: string[]
  spendTypes: string[]
  eligibility: string[]
}

export interface SaveResult {
  saved: number
  removed: string[]
}

const COLUMNS: Array<[string, (r: SchemeRecord) => unknown]> = [
  ['id', (r) => r.id],
  ['type', (r) => r.type],
  ['name', (r) => r.name],
  ['provider', (r) => r.provider],
  ['summary', (r) => r.summary],
  ['who_can_apply', (r) => r.whoCanApply],
  ['url', (r) => r.url],
  ['application_url', (r) => r.applicationUrl],
  ['status', (r) => r.status],
  ['next_round', (r) => r.nextRound],
  ['source_type', (r) => r.sourceType],
  ['amount_min', (r) => r.amountMin],
  ['amount_max', (r) => r.amountMax],
  ['match_funding_required', (r) => r.matchFundingRequired],
  ['match_funding_percent', (r) => r.matchFundingPercent],
  ['closes_on', (r) => r.closesOn],
  ['support_speed', (r) => r.supportSpeed],
  ['decision_time', (r) => r.decisionTime],
  ['premises_required', (r) => r.premisesRequired],
  ['premises_tenure', (r) => r.premisesTenure],
  ['checked_on', (r) => r.checkedOn],
  ['checked_by', (r) => r.checkedBy],
  ['status_checked_on', (r) => r.statusCheckedOn],
  ['review_by', (r) => r.reviewBy],
  ['example', (r) => r.example]
]

const UPSERT_SQL = `
  insert into schemes (${COLUMNS.map(([column]) => column).join(', ')})
  values (${COLUMNS.map((_, index) => `$${index + 1}`).join(', ')})
  on conflict (id) do update set
    ${COLUMNS.slice(1).map(([column]) => `${column} = excluded.${column}`).join(',\n    ')},
    replaced_by = null`

const LISTS: Array<[string, string, (r: SchemeRecord) => string[]]> = [
  ['scheme_sectors', 'sector', (r) => r.sectors],
  ['scheme_purposes', 'purpose', (r) => r.purposes],
  ['scheme_areas', 'area_code', (r) => r.areas],
  ['scheme_business_stages', 'business_stage', (r) => r.businessStages],
  ['scheme_legal_structures', 'legal_structure', (r) => r.legalStructures],
  ['scheme_spend_types', 'spend_type', (r) => r.spendTypes]
]

const DETAIL_TABLES = ['loan_details', 'grant_details', 'equity_details']

async function saveScheme (client: pg.PoolClient, record: SchemeRecord): Promise<void> {
  const { id } = record

  await client.query(UPSERT_SQL, COLUMNS.map(([, value]) => value(record) ?? null))

  // Replace the scheme's details and lists.
  for (const table of [...DETAIL_TABLES, ...LISTS.map(([table]) => table), 'scheme_eligibility']) {
    await client.query(`delete from ${table} where scheme_id = $1`, [id])
  }

  if (record.type === 'loan') {
    const { interestRate, repaymentTerm, fees } = record.loan ?? {}
    await client.query('insert into loan_details (scheme_id, interest_rate, repayment_term, fees) values ($1, $2, $3, $4)',
      [id, interestRate ?? null, repaymentTerm ?? null, fees ?? null])
  } else if (record.type === 'grant') {
    const { contribution, paidInArrears, subsidyControlApplies } = record.grant ?? {}
    await client.query('insert into grant_details (scheme_id, contribution, paid_in_arrears, subsidy_control_applies) values ($1, $2, $3, $4)',
      [id, contribution ?? null, paidInArrears ?? null, subsidyControlApplies ?? null])
  } else {
    const { investmentType, ownershipExchangeRequired, followOnInvestmentAvailable } = record.equity ?? {}
    await client.query('insert into equity_details (scheme_id, investment_type, ownership_exchange_required, follow_on_investment_available) values ($1, $2, $3, $4)',
      [id, investmentType ?? null, ownershipExchangeRequired ?? null, followOnInvestmentAvailable ?? null])
  }

  for (const [table, column, values] of LISTS) {
    await client.query(`insert into ${table} (scheme_id, ${column}) select $1, unnest($2::text[])`, [id, values(record)])
  }

  await client.query(`
    insert into scheme_eligibility (scheme_id, position, criterion)
    select $1, position, criterion from unnest($2::text[]) with ordinality as list (criterion, position)`,
  [id, record.eligibility])
}

// Saves the schemes in one transaction, so the database matches them:
// schemes are added or updated, and schemes not in the list are removed.
// If any scheme cannot be saved, nothing changes.
export async function saveSchemes (pool: pg.Pool, records: SchemeRecord[]): Promise<SaveResult> {
  const client = await pool.connect()

  try {
    await client.query('begin')

    for (const record of records) {
      try {
        await saveScheme(client, record)
      } catch (err) {
        // For example, a sector that is not on the list.
        const { message, detail } = err as { message: string, detail?: string }
        throw new Error(`Problems with the funding data:\n${record.id}: ${detail ?? message}`)
      }
    }

    // Replacement schemes are linked once every scheme is saved, so a scheme
    // can be replaced by one that comes after it.
    for (const { id, replacedBy } of records.filter((record) => record.replacedBy)) {
      await client.query('update schemes set replaced_by = $2 where id = $1', [id, replacedBy])
    }

    const removed = await client.query<{ id: string }>('delete from schemes where not (id = any($1::text[])) returning id', [records.map((record) => record.id)])
    await client.query('commit')

    return { saved: records.length, removed: removed.rows.map((row) => row.id).sort() }
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
}
