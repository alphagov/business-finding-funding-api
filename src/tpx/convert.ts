import type { SchemeRecord } from '../records'
import type { FundingType } from '../schemes'
import { BUSINESS_STAGES, GOALS, INVESTMENT_TYPES, SECTORS, SPEND_TYPES, STATUSES, SUPPORT_SPEEDS, UK_WIDE_AREAS } from './mapping'
import { SHEETS, type Cell, type Workbook, type WorkbookRow } from './workbook'

// Turns the rows of TPX's One Platform schema workbook into scheme records,
// using the mappings in mapping.ts. A row with any problem is not turned
// into a record. Its problems are reported instead, so they can be fixed in
// the workbook.

// The values on our fixed lists, read from the database.
export interface Lists {
  statuses: Set<string>
  sourceTypes: Set<string>
  spendTypes: Set<string>
  purposes: Set<string>
  businessStages: Set<string>
  legalStructures: Set<string>
  // Sector names in lower case, and the sector codes.
  sectors: Map<string, string>
  areas: Set<string>
}

export interface RowProblems {
  id: string
  sheet: string
  row: number
  problems: string[]
}

export interface Conversion {
  records: SchemeRecord[]
  rejected: RowProblems[]
  // Workbook columns that are not imported.
  ignoredColumns: string[]
}

// Columns that are read. record_kind is always "opportunity", so is not kept.
const COLUMNS = new Set([
  'scheme_id', 'scheme_name', 'help_type', 'source_type', 'support_goals', 'provider_name', 'min_amount', 'max_amount',
  'summary_what', 'summary_who', 'summary_criteria', 'interest_rate_text', 'repayment_terms_text', 'fees',
  'speed_to_support', 'premises_required', 'premises_tenure', 'successor_id', 'next_round_signal', 'application_url',
  'stage', 'sectors', 'entity_types', 'status', 'source_url', 'area_level', 'area_codes', 'status_checked_date',
  'verified_date', 'verified_by', 'record_kind', 'review_by_date', 'match_funding_percentage', 'match_funding_required',
  'max_project_cost_coverage', 'decision_time_typical', 'paid_in_arrears', 'spend_type', 'closing_date',
  'subsidy_control_applies', 'investment_type', 'ownership_exchange_required', 'follow_on_investment_available'
])

const ANY = 'any'

const YES_NO: Record<string, boolean> = { yes: true, no: false }

// Reads one row, collecting its problems rather than stopping at the first.
class RowReader {
  readonly problems: string[] = []

  constructor (private readonly values: Record<string, Cell>, private readonly lists: Lists) {}

  problem (message: string): void {
    this.problems.push(message)
  }

  // Text with line breaks and repeated spaces tidied, or undefined if blank.
  text (column: string): string | undefined {
    const value = this.values[column]
    if (value === null || value === undefined) return undefined
    if (value instanceof Date) return value.toISOString().slice(0, 10)
    const text = String(value).replace(/\s+/g, ' ').trim()
    return text === '' ? undefined : text
  }

  required (column: string): string {
    const text = this.text(column)
    if (text === undefined) this.problem(`${column} is missing`)
    return text ?? ''
  }

  // A list separated by "|", as the workbook uses.
  list (column: string): string[] {
    return (this.text(column) ?? '').split('|').map((item) => item.trim()).filter(Boolean)
  }

  // A code in lower case with underscores, the form the mapping keys use.
  static key (value: string): string {
    return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
  }

  static code (value: string): string {
    return RowReader.key(value).replace(/_/g, '-')
  }

  url (column: string, required: boolean): string | undefined {
    const url = required ? this.required(column) : this.text(column)
    if (url && !/^https:\/\/\S+$/.test(url)) this.problem(`${column} must be a web address starting https://, not ${url}`)
    return url
  }

  date (column: string, { required = false, allowRolling = false } = {}): string | undefined {
    const value = this.values[column]
    if (value instanceof Date) return value.toISOString().slice(0, 10)

    const text = this.text(column)
    if (text === undefined) {
      if (required) this.problem(`${column} is missing`)
      return undefined
    }
    if (allowRolling && text.toUpperCase() === 'ROLLING') return undefined
    if (/^\d{4}-\d{2}-\d{2}$/.test(text) && !Number.isNaN(Date.parse(text))) return text

    this.problem(`${column} must be a date${allowRolling ? ' or ROLLING' : ''}, not "${text}"`)
    return undefined
  }

  yesNo (column: string): boolean | undefined {
    const text = this.text(column)
    if (text === undefined) return undefined
    const answer = YES_NO[text.toLowerCase()]
    if (answer === undefined) this.problem(`${column} must be Yes or No, not "${text}"`)
    return answer
  }

  amount (column: string, { max }: { max?: number } = {}): number | undefined {
    const value = this.values[column]
    if (value === null || value === undefined || value === '') return undefined
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || (max !== undefined && value > max)) {
      this.problem(`${column} must be a whole number${max !== undefined ? ` from 0 to ${max}` : ''}, not "${String(value)}"`)
      return undefined
    }
    return value
  }

  // One value from a fixed list, or a value the mapping turns into one.
  choice (column: string, allowed: Set<string>, mapping: Record<string, string> = {}): string | undefined {
    const text = this.text(column)
    if (text === undefined) return undefined
    const code = mapping[RowReader.key(text)] ?? RowReader.code(text)
    if (!allowed.has(code)) this.problem(`${column} "${text}" is not on our list and has no mapping`)
    return code
  }

  // A list of values from a fixed list. "any" means open to all, so an
  // empty list.
  choices (column: string, allowed: Set<string>, mapping: Record<string, string | string[]> = {}): string[] {
    const items = this.list(column)
    if (items.some((item) => item.toLowerCase() === ANY)) {
      if (items.length > 1) this.problem(`${column} lists "any" with other values`)
      return []
    }

    const codes = items.flatMap((item) => {
      const mapped = mapping[RowReader.key(item)]
      const result = mapped === undefined ? [RowReader.code(item)] : ([] as string[]).concat(mapped)
      const bad = result.filter((code) => !allowed.has(code))
      if (bad.length) this.problem(`${column} "${item}" is not on our list and has no mapping`)
      return result
    })
    return [...new Set(codes)]
  }

  sectors (): string[] {
    const items = this.list('sectors')
    if (items.some((item) => item.toLowerCase() === ANY)) {
      if (items.length > 1) this.problem(`sectors lists "any" with other values`)
      return []
    }

    const codes = items.flatMap((item) => {
      const code = this.lists.sectors.get(item.toLowerCase())
      if (code) return [code]
      const mapped = SECTORS[RowReader.key(item)]
      if (mapped) return mapped
      this.problem(`sectors "${item}" is not on our list and has no mapping`)
      return []
    })
    return [...new Set(codes)]
  }

  purposes (): string[] {
    const goals = this.list('support_goals')
    const purposes = goals.flatMap((goal) => {
      const mapped = GOALS[RowReader.key(goal)]
      if (mapped === undefined) this.problem(`support_goals "${goal}" has no mapping`)
      return mapped ?? []
    })
    if (goals.length && !purposes.length && !this.problems.length) {
      this.problem(`support_goals ${goals.join(', ')} have no matching purposes, so the scheme would look open to every purpose`)
    }
    for (const purpose of purposes) {
      if (!this.lists.purposes.has(purpose)) this.problem(`the mapping for support_goals uses ${purpose}, which is not on our list`)
    }
    return [...new Set(purposes)]
  }

  areas (): string[] {
    const level = this.text('area_level')?.toLowerCase()
    const codes = this.list('area_codes').map((code) => code.toUpperCase())
    const ukWide = codes.filter((code) => code in UK_WIDE_AREAS)

    if (ukWide.length && ukWide.length < codes.length) this.problem(`area_codes mixes UK-wide codes with other areas: ${codes.join(', ')}`)
    if (!codes.length && level !== 'national') this.problem(`area_codes is empty for a ${level ?? 'scheme with no area level'}`)

    const areas = codes.flatMap((code) => UK_WIDE_AREAS[code] ?? [code])
    for (const code of areas) {
      if (!this.lists.areas.has(code)) this.problem(`area_codes ${code} is not a current ONS country, region, county or local authority code`)
    }
    return [...new Set(areas)]
  }
}

function convertRow ({ sheet, values }: WorkbookRow, lists: Lists): { record: SchemeRecord, problems: string[] } {
  const r = new RowReader(values, lists)
  const id = r.required('scheme_id')
  if (id && !/^[a-z0-9]+([_-][a-z0-9]+)*$/.test(id)) r.problem('scheme_id must use lower case letters and numbers, joined by underscores')

  const type = SHEETS[sheet] as FundingType
  const helpType = r.text('help_type')
  if (helpType?.toLowerCase() !== type) r.problem(`help_type is ${helpType ?? 'missing'}, but the scheme is on the ${sheet} sheet`)

  const status = r.choice('status', lists.statuses, STATUSES)
  if (status === undefined) r.problem('status is missing')

  const amountMin = r.amount('min_amount')
  const amountMax = r.amount('max_amount')
  if (amountMin !== undefined && amountMax !== undefined && amountMin > amountMax) r.problem(`min_amount ${amountMin} is more than max_amount ${amountMax}`)

  const checkedOn = r.date('verified_date', { required: true })
  const reviewBy = r.date('review_by_date')
  if (checkedOn && reviewBy && reviewBy < checkedOn) r.problem(`review_by_date ${reviewBy} is before verified_date ${checkedOn}`)

  const eligibility = r.list('summary_criteria')
  if (!eligibility.length) r.problem('summary_criteria is missing')

  const spend = r.choices('spend_type', lists.spendTypes, SPEND_TYPES)
  const tenure = r.text('premises_tenure')?.toLowerCase()
  if (tenure && !['own', 'rent', 'either'].includes(tenure)) r.problem(`premises_tenure must be own, rent or either, not "${tenure}"`)

  const investmentType = r.text('investment_type')
  const investment = investmentType && (INVESTMENT_TYPES[RowReader.key(investmentType)] ?? investmentType)

  const record: SchemeRecord = {
    id,
    type,
    name: r.required('scheme_name'),
    provider: r.required('provider_name'),
    summary: r.required('summary_what'),
    whoCanApply: r.text('summary_who'),
    url: r.url('source_url', true) ?? '',
    applicationUrl: r.url('application_url', false),
    status: status ?? '',
    replacedBy: r.text('successor_id'),
    nextRound: r.text('next_round_signal'),
    sourceType: r.choice('source_type', lists.sourceTypes),
    amountMin,
    amountMax,
    matchFundingRequired: r.yesNo('match_funding_required'),
    matchFundingPercent: r.amount('match_funding_percentage', { max: 100 }),
    closesOn: r.date('closing_date', { allowRolling: true }),
    supportSpeed: r.choice('speed_to_support', new Set(Object.values(SUPPORT_SPEEDS)), SUPPORT_SPEEDS),
    decisionTime: r.text('decision_time_typical'),
    premisesRequired: r.yesNo('premises_required'),
    premisesTenure: tenure,
    checkedOn: checkedOn ?? '',
    checkedBy: r.text('verified_by'),
    statusCheckedOn: r.date('status_checked_date'),
    reviewBy,
    example: false,
    loan: { interestRate: r.text('interest_rate_text'), repaymentTerm: r.text('repayment_terms_text'), fees: r.text('fees') },
    grant: { contribution: r.text('max_project_cost_coverage'), paidInArrears: r.yesNo('paid_in_arrears'), subsidyControlApplies: r.yesNo('subsidy_control_applies') },
    equity: { investmentType: investment, ownershipExchangeRequired: r.yesNo('ownership_exchange_required'), followOnInvestmentAvailable: r.yesNo('follow_on_investment_available') },
    sectors: r.sectors(),
    purposes: r.purposes(),
    areas: r.areas(),
    businessStages: r.choices('stage', lists.businessStages, BUSINESS_STAGES),
    legalStructures: r.choices('entity_types', lists.legalStructures),
    spendTypes: spend,
    eligibility
  }

  return { record, problems: r.problems }
}

export function convertWorkbook ({ rows, columns }: Workbook, lists: Lists): Conversion {
  const converted = rows.map((row) => ({ row, ...convertRow(row, lists) }))

  // A scheme that appears more than once is reported every time, because
  // there is no way to tell which row is right.
  const counts = new Map<string, number>()
  for (const { record } of converted) counts.set(record.id, (counts.get(record.id) ?? 0) + 1)
  for (const { record, row, problems } of converted) {
    const others = converted.filter((other) => other.record.id === record.id && other.row !== row).map((other) => `${other.row.sheet} row ${other.row.row}`)
    if ((counts.get(record.id) ?? 0) > 1) problems.push(`scheme_id is also used on ${others.join(', ')}`)
  }

  // A replacement scheme must be in the workbook, and must be imported.
  const good = new Set(converted.filter(({ problems }) => !problems.length).map(({ record }) => record.id))
  for (const { record, problems } of converted) {
    if (record.replacedBy && !good.has(record.replacedBy)) problems.push(`successor_id ${record.replacedBy} is not a scheme that can be imported`)
  }

  const ignoredColumns = [...new Set(Object.values(columns).flat())].filter((column) => !COLUMNS.has(column)).sort()

  return {
    records: converted.filter(({ problems }) => !problems.length).map(({ record }) => record),
    rejected: converted.filter(({ problems }) => problems.length).map(({ record, row, problems }) => ({ id: record.id || '(no scheme_id)', sheet: row.sheet, row: row.row, problems })),
    ignoredColumns
  }
}
