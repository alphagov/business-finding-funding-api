import type { Entry, SourceName, Value } from './entry'
import { listOf } from './text'
import {
  ENGLAND,
  FIND_A_GRANT_APPLICANTS,
  FIND_A_GRANT_LOCATIONS,
  FUNDING_TYPES,
  GOVUK_INDUSTRIES,
  GOVUK_STAGES,
  GROWTH_HUB_STAGES,
  NORTH_EAST_COUNCILS,
  NOT_SECTORS,
  NOT_STAGES,
  REGIONS,
  TEES_VALLEY_SECTORS,
  TEES_VALLEY_STAGES,
  UK_WIDE
} from './mapping'

// Days 3 and 4 of the spike: for each entry, how each of the funding data
// API's fields could be filled from the source.
//
// - coded: from a coded value or a labelled field, mapped by the tables in
//   mapping.ts, with no reading needed
// - text: not in a field, but the entry's text may say it, so a person
//   would have to read it (or AI would have to)
// - none: the source does not give it
//
// "text" is decided by simple word patterns, so it shows where a value
// might be found, not that it is there. The values themselves are checked
// against the running bodies' pages on day 5.

export type How = 'coded' | 'text' | 'none'

export interface Cell {
  how: How
  value?: Value
  // Coded values with no entry in mapping.ts.
  unmapped?: string[]
}

export const FIELDS = {
  type: 'Type of funding',
  name: 'Name',
  provider: 'Provider',
  summary: 'Summary',
  who_can_apply: 'Who can apply',
  url: "Provider's page",
  application_url: 'Application page',
  status: 'Status',
  amounts: 'Amounts',
  match_funding: 'Match funding',
  closes_on: 'Closing date',
  areas: 'Areas',
  business_stages: 'Business stages',
  sectors: 'Sectors',
  legal_structures: 'Legal structures',
  purposes: 'Purposes',
  eligibility: 'Eligibility criteria',
  updated: 'Last updated'
} as const

export type Field = keyof typeof FIELDS

export interface Mapped {
  source: SourceName
  id: string
  name: string
  page: string
  // Whether it is a grant, and whether that comes from a coded value or
  // only from the words in its name and text.
  grant: boolean
  grantFrom: 'coded' | 'text'
  fields: Record<Field, Cell>
}

const MONTHS = 'january|february|march|april|may|june|july|august|september|october|november|december'

// Word patterns for the fields a description may state.
const IN_TEXT: Partial<Record<Field, RegExp>> = {
  type: /\b(grants?|loans?|equity|investments?)\b/i,
  status: /\b(open|closed|closing|paused|fully (allocated|subscribed)|now accepting|not currently)\b/i,
  amounts: /£\s?\d/,
  match_funding: /match[- ]?fund|\d+\s?%|per ?cent/i,
  closes_on: new RegExp(`\\b(deadline|closing date|closes|apply by)\\b|\\b\\d{1,2}(st|nd|rd|th)?\\s+(${MONTHS})\\b`, 'i'),
  legal_structures: /\b(sole traders?|limited compan(y|ies)|charit(y|ies)|social enterprises?|community interest|cics?|partnerships?|co-?operatives?)\b/i
}

// Fields any description may say something about.
const ANY_TEXT = new Set<Field>(['provider', 'summary', 'who_can_apply', 'purposes', 'eligibility'])

// Links are never read from text.
const NEVER_TEXT = new Set<Field>(['name', 'url', 'application_url', 'areas', 'business_stages', 'sectors', 'updated'])

function fromText (field: Field, text: string): Cell {
  if (text.trim() === '' || NEVER_TEXT.has(field)) return { how: 'none' }
  if (ANY_TEXT.has(field)) return { how: 'text' }
  return IN_TEXT[field]?.test(text) === true ? { how: 'text' } : { how: 'none' }
}

const coded = (value: Value, unmapped: string[] = []): Cell => unmapped.length > 0 ? { how: 'coded', value, unmapped } : { how: 'coded', value }

function asList (value: Value | undefined): string[] {
  if (Array.isArray(value)) return value
  return typeof value === 'string' ? listOf(value) : []
}

// Maps a list through a table. If the source lists every value the table
// has, or the result covers every value the API has, it is open to all.
function mapList (items: string[], table: Record<string, string[]>, skip: Set<string> = new Set(), every: number = Infinity): Cell {
  const kept = items.filter((item) => !skip.has(item))
  if (kept.length === 0) return { how: 'none' }
  const unmapped = kept.filter((item) => table[item] === undefined)
  if (kept.filter((item) => table[item] !== undefined).length === Object.keys(table).length) return coded([], unmapped)
  const codes = [...new Set(kept.flatMap((item) => table[item] ?? []))]
  return coded(codes.length >= every ? [] : codes, unmapped)
}

const ALL_STAGES = 4

// Amounts from a labelled value such as "£5,000 – £35,000" or "Up to £1m".
export function amountsFrom (text: string): { min: number | null, max: number | null } | null {
  const amounts = [...text.matchAll(/£\s?([\d,.]+)\s*(k|m|million|bn|billion)?\b/gi)].map((match) => {
    const number = Number(match[1].replaceAll(',', ''))
    const scale = { k: 1e3, m: 1e6, million: 1e6, bn: 1e9, billion: 1e9 }[(match[2] ?? '').toLowerCase()] ?? 1
    return Math.round(number * scale)
  }).filter((amount) => Number.isFinite(amount))
  if (amounts.length === 0) return null
  if (amounts.length === 1) return /up to|maximum|max\b/i.test(text) ? { min: null, max: amounts[0] } : { min: amounts[0], max: amounts[0] }
  return { min: Math.min(...amounts), max: Math.max(...amounts) }
}

function govukAreas (regions: string[]): Cell {
  const all = Object.keys(REGIONS)
  if (all.every((region) => regions.includes(region))) return coded(UK_WIDE)
  const english = all.filter((region) => REGIONS[region].startsWith('E12'))
  const others = regions.filter((region) => !english.includes(region))
  const codes = english.every((region) => regions.includes(region))
    ? [ENGLAND, ...others.map((region) => REGIONS[region]).filter(Boolean)]
    : regions.map((region) => REGIONS[region]).filter(Boolean)
  return coded(codes, regions.filter((region) => REGIONS[region] === undefined))
}

function councils (names: string[]): Cell {
  if (names.length === 0) return { how: 'none' }
  return coded(names.map((name) => NORTH_EAST_COUNCILS[name]).filter(Boolean), names.filter((name) => NORTH_EAST_COUNCILS[name] === undefined))
}

function fundingTypes (kinds: string[]): Cell | null {
  const types = [...new Set(kinds.map((kind) => FUNDING_TYPES[kind.toLowerCase()]).filter(Boolean))]
  return types.length > 0 ? coded(types) : null
}

function govuk (entry: Entry): Partial<Record<Field, Cell>> {
  const f = entry.fields
  return {
    type: fundingTypes(asList(f.types_of_support)) ?? undefined,
    summary: typeof f.description === 'string' ? coded(f.description) : undefined,
    url: entry.providerPage === null ? undefined : coded(entry.providerPage),
    areas: govukAreas(asList(f.regions)),
    business_stages: mapList(asList(f.business_stages), GOVUK_STAGES, new Set(), ALL_STAGES),
    sectors: mapList(asList(f.industries), GOVUK_INDUSTRIES)
  }
}

// Find a Grant lists open grants only, and its dates say whether a grant has
// opened yet.
function grantStatus (opening: Value, closing: Value, readOn: string): string {
  if (typeof opening === 'string' && opening.slice(0, 10) > readOn) return 'pre-launch'
  if (typeof closing === 'string' && closing.slice(0, 10) < readOn) return 'closed'
  return 'open'
}

function findAGrant (entry: Entry, readOn: string): Partial<Record<Field, Cell>> {
  const f = entry.fields
  const applicants = asList(f.applicant_types)
  const kinds = applicants.map((one) => FIND_A_GRANT_APPLICANTS[one])
  const locations = asList(f.location)
  const unknownLocations = locations.filter((one) => FIND_A_GRANT_LOCATIONS[one] === undefined)
  return {
    type: coded(['grant']),
    provider: entry.provider === null ? undefined : coded(entry.provider),
    summary: typeof f.short_description === 'string' ? coded(f.short_description) : undefined,
    who_can_apply: applicants.length > 0 ? coded(applicants) : undefined,
    application_url: entry.applyPage === null ? undefined : coded(entry.applyPage),
    status: coded(grantStatus(f.opening_date, f.closing_date, readOn)),
    amounts: f.minimum_award === null && f.maximum_award === null ? undefined : coded([String(f.minimum_award ?? ''), String(f.maximum_award ?? '')]),
    closes_on: typeof f.closing_date === 'string' ? coded(f.closing_date.slice(0, 10)) : undefined,
    areas: locations.includes('National')
      ? coded(UK_WIDE, unknownLocations)
      : coded([...new Set(locations.flatMap((one) => FIND_A_GRANT_LOCATIONS[one] ?? []))], unknownLocations),
    legal_structures: kinds.includes('all')
      ? coded([])
      : kinds.some(Array.isArray) ? coded([...new Set(kinds.filter(Array.isArray).flat())]) : undefined
  }
}

function growthHub (entry: Entry): Partial<Record<Field, Cell>> {
  const f = entry.fields
  const size = typeof f.grant_size === 'string' ? amountsFrom(f.grant_size) : null
  return {
    type: fundingTypes(asList(f.categories)) ?? undefined,
    provider: entry.provider === null ? undefined : coded(entry.provider),
    summary: typeof f.summary === 'string' && f.summary !== '' ? coded(f.summary) : undefined,
    who_can_apply: typeof f.open_to === 'string' ? coded(f.open_to) : undefined,
    url: entry.providerPage === null ? undefined : coded(entry.providerPage),
    status: typeof f.status === 'string' ? coded(f.status) : undefined,
    amounts: size === null ? undefined : coded([String(size.min ?? ''), String(size.max ?? '')]),
    closes_on: typeof f.deadline === 'string' ? coded(f.deadline) : undefined,
    areas: councils(asList(f.area)),
    business_stages: mapList(asList(f.business_stage), GROWTH_HUB_STAGES, new Set(), ALL_STAGES)
  }
}

function teesValley (entry: Entry): Partial<Record<Field, Cell>> {
  const f = entry.fields
  return {
    url: entry.providerPage === null ? undefined : coded(entry.providerPage),
    application_url: entry.applyPage === null ? undefined : coded(entry.applyPage),
    areas: councils(asList(f.location)),
    business_stages: mapList(asList(f.business_stage), TEES_VALLEY_STAGES, NOT_STAGES, ALL_STAGES),
    sectors: mapList(asList(f.sector), TEES_VALLEY_SECTORS, NOT_SECTORS)
  }
}

export function isGrant (entry: Entry): { grant: boolean, grantFrom: 'coded' | 'text' } {
  const f = entry.fields
  switch (entry.source) {
    case 'govuk-finder': return { grant: asList(f.types_of_support).includes('grant'), grantFrom: 'coded' }
    case 'find-a-grant': return { grant: true, grantFrom: 'coded' }
    case 'north-east-growth-hub': return { grant: asList(f.categories).includes('Grant'), grantFrom: 'coded' }
    case 'tees-valley': return { grant: /\bgrants?\b/i.test(`${entry.name} ${entry.text}`), grantFrom: 'text' }
  }
}

// Whether an entry is about funding at all, as opposed to advice or other
// support.
export function isFunding (entry: Entry): boolean {
  const f = entry.fields
  switch (entry.source) {
    case 'govuk-finder': return asList(f.types_of_support).some((kind) => ['grant', 'loan', 'equity', 'finance'].includes(kind))
    case 'find-a-grant': return true
    case 'north-east-growth-hub': return entry.read === 'page'
    case 'tees-valley': return asList(f.help_categories).includes('Accessing Finance & Funding')
  }
}

export function mapEntry (entry: Entry, readOn: string): Mapped {
  const bySource = {
    'govuk-finder': () => govuk(entry),
    'find-a-grant': () => findAGrant(entry, readOn),
    'north-east-growth-hub': () => growthHub(entry),
    'tees-valley': () => teesValley(entry)
  }[entry.source]()

  const known: Partial<Record<Field, Cell>> = {
    name: coded(entry.name),
    updated: entry.updated === null ? undefined : coded(entry.updated),
    ...Object.fromEntries(Object.entries(bySource).filter(([, cell]) => cell !== undefined))
  }

  const fields = Object.fromEntries((Object.keys(FIELDS) as Field[]).map((field) => [
    field,
    known[field] ?? fromText(field, `${entry.name}\n${entry.text}`)
  ])) as Record<Field, Cell>

  return { source: entry.source, id: entry.id, name: entry.name, page: entry.page, ...isGrant(entry), fields }
}

export type Counts = Record<How, number>

export function coverage (mapped: Mapped[]): Record<Field, Counts> {
  return Object.fromEntries((Object.keys(FIELDS) as Field[]).map((field) => {
    const counts: Counts = { coded: 0, text: 0, none: 0 }
    for (const one of mapped) counts[one.fields[field].how] += 1
    return [field, counts]
  })) as Record<Field, Counts>
}
