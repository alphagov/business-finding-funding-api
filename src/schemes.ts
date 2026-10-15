import fs from 'node:fs'
import path from 'node:path'

// A funding scheme a business could apply for, in the format the API
// publishes. The schemes are kept in a JSON file, which is checked before
// it is loaded into the database (see src/load.ts), so a mistake in the
// data stops the release instead of publishing something wrong.

export type FundingType = 'loan' | 'grant' | 'equity'

export interface Scheme {
  id: string
  type: FundingType
  name: string
  provider: string
  summary: string
  url: string
  // When the details were last checked with the provider, as YYYY-MM-DD.
  checkedOn: string
  // Where the scheme is available. Leave out for the whole of the UK. A
  // business is covered if its area matches any of these.
  areas?: {
    countries?: string[]
    regions?: string[]
    // Office for National Statistics (GSS) codes, for example E08000003
    localAuthorities?: string[]
  }
  // In pounds. Leave out either end if there is no limit.
  amount?: { min?: number, max?: number }
  // Sector and purpose values from the Find funding questions. Leave out to
  // match all.
  sectors?: string[]
  purposes?: string[]
  // The last day to apply, as YYYY-MM-DD. Leave out if there is no deadline.
  closesOn?: string
  matchFundingRequired?: boolean
  interestRate?: string
  repaymentTerm?: string
  fees?: string
  contribution?: string
  decisionTime?: string
  investmentType?: string
  eligibility: string[]
}

export interface FundingData {
  // True while the file holds made-up schemes for testing. Services using
  // the API should then say the schemes are not real.
  example: boolean
  schemes: Scheme[]
}

const DATA_FILE = path.join(__dirname, '..', 'data', 'funding-schemes.json')

export const TYPES: FundingType[] = ['loan', 'grant', 'equity']

function isDate (value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}

function isStringList (value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string' && item !== '')
}

// Returns a list of problems with the schemes, or an empty list if there
// are none.
export function checkSchemes (schemes: unknown): string[] {
  if (!Array.isArray(schemes)) return ['Schemes must be a list']

  const problems: string[] = []
  const ids = new Set<string>()

  schemes.forEach((scheme: Partial<Record<keyof Scheme, unknown>>, index) => {
    const name = typeof scheme.id === 'string' ? scheme.id : `scheme ${index + 1}`
    const problem = (message: string): void => { problems.push(`${name}: ${message}`) }

    for (const field of ['id', 'name', 'provider', 'summary', 'url'] as const) {
      if (typeof scheme[field] !== 'string' || scheme[field] === '') problem(`${field} is missing`)
    }
    if (typeof scheme.id === 'string') {
      if (!/^[a-z0-9-]+$/.test(scheme.id)) problem('id must only use lower case letters, numbers and hyphens')
      if (ids.has(scheme.id)) problem('id is used more than once')
      ids.add(scheme.id)
    }
    if (!TYPES.includes(scheme.type as FundingType)) problem(`type must be one of ${TYPES.join(', ')}`)
    if (typeof scheme.url === 'string' && !scheme.url.startsWith('https://')) problem('url must start with https://')
    if (!isDate(scheme.checkedOn)) problem('checkedOn must be a date like 2026-10-08')
    if (scheme.closesOn !== undefined && !isDate(scheme.closesOn)) problem('closesOn must be a date like 2026-10-08')
    if (!isStringList(scheme.eligibility)) problem('eligibility must be a list of text')

    for (const field of ['sectors', 'purposes'] as const) {
      if (scheme[field] !== undefined && !isStringList(scheme[field])) problem(`${field} must be a list of text`)
    }

    const areas = scheme.areas as Scheme['areas'] | undefined
    if (areas !== undefined) {
      for (const field of ['countries', 'regions', 'localAuthorities'] as const) {
        if (areas[field] !== undefined && !isStringList(areas[field])) problem(`areas.${field} must be a list of text`)
      }
    }

    const amount = scheme.amount as Scheme['amount'] | undefined
    if (amount !== undefined) {
      const { min = 0, max = Infinity } = amount
      if (typeof min !== 'number' || typeof max !== 'number' || min < 0 || min > max) problem('amount must have a min no bigger than its max')
    }
  })

  return problems
}

// Checks the funding data, and throws an error listing every problem.
export function checkFunding (data: unknown, source: string): FundingData {
  const { example, schemes } = (data ?? {}) as Partial<FundingData>
  const problems = checkSchemes(schemes)

  if (typeof example !== 'boolean') problems.unshift('example must be true or false')
  if (problems.length) throw new Error(`Problems with ${source}:\n${problems.join('\n')}`)
  return { example, schemes } as FundingData
}

export function loadFunding (file = DATA_FILE): FundingData {
  return checkFunding(JSON.parse(fs.readFileSync(file, 'utf8')), path.basename(file))
}
