import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { OUTPUT } from './collect'
import type { Collection, Entry, SourceName, Value } from './entry'
import { isFunding, isGrant, mapEntry, type Field } from './map'
import { GOVUK_INDUSTRIES, REGIONS, TEES_VALLEY_SECTORS } from './mapping'

// Day 5 of the spike: a checklist for a person to check what each source
// says against the running body's own page. The spike uses no AI, so the
// check is done by a person, not by reading the pages with a model.
//
//   npm run spike:checklist
//
// It takes 10 grants from each source, picked by a fixed shuffle so the
// sample is the same each time and not chosen by hand. Tees Valley does not
// say which entries are grants, so its sample is topped up with other
// funding entries. Each value the source gives is a row, with the running
// body's page beside it and a column for the result. The file is a CSV that
// opens in Excel, written to the collection's folder.

const SOURCES: SourceName[] = ['govuk-finder', 'find-a-grant', 'north-east-growth-hub', 'tees-valley']
const SAMPLE = 10

const SOURCE_NAMES: Record<SourceName, string> = {
  'govuk-finder': 'GOV.UK business finance support finder',
  'find-a-grant': 'Find a Grant',
  'north-east-growth-hub': 'North East Growth Hub',
  'tees-valley': 'Tees Valley directory'
}

const QUESTIONS: Partial<Record<Field, string>> = {
  type: 'Type of funding',
  provider: 'Who runs it',
  amounts: 'How much',
  closes_on: 'Closing date',
  status: 'Whether it is open',
  areas: 'Where it is available',
  business_stages: 'Business stages it is for',
  sectors: 'Sectors it is for',
  who_can_apply: 'Who can apply'
}

export const RESULTS = 'Right / Wrong / Partly right / Not on the page / Page not found'

export interface CheckRow {
  check: number
  source: string
  scheme: string
  sourcePage: string
  runningBodyPage: string
  question: string
  sourceSays: string
}

function shuffleKey (entry: Entry): string {
  return createHash('sha256').update(`ff-121 ${entry.source} ${entry.id}`).digest('hex')
}

export function sample (entries: Entry[], size = SAMPLE): Entry[] {
  const funding = entries.filter(isFunding).sort((a, b) => shuffleKey(a).localeCompare(shuffleKey(b)))
  const grants = funding.filter((entry) => isGrant(entry).grant)
  const others = funding.filter((entry) => !isGrant(entry).grant)
  return [...grants, ...others].slice(0, size)
}

function list (value: Value | undefined): string[] {
  if (Array.isArray(value)) return value
  return typeof value === 'string' && value !== '' ? [value] : []
}

function words (items: string[], every: string[], all: string): string {
  return every.length > 0 && every.every((item) => items.includes(item)) ? all : items.join(', ')
}

// GOV.UK's codes in plain words, such as "start-up" or "east-midlands".
const REGION_NAMES: Record<string, string> = {
  'north-east': 'North East',
  'north-west': 'North West',
  'yorkshire-and-the-humber': 'Yorkshire and the Humber',
  'east-midlands': 'East Midlands',
  'west-midlands': 'West Midlands',
  eastern: 'East of England',
  london: 'London',
  'south-east': 'South East',
  'south-west': 'South West',
  scotland: 'Scotland',
  wales: 'Wales',
  'northern-ireland': 'Northern Ireland'
}

function plain (code: string): string {
  return REGION_NAMES[code] ?? code.replaceAll('-', ' ')
}

export function govukAreas (regions: string[]): string {
  const all = Object.keys(REGIONS)
  if (all.every((region) => regions.includes(region))) return 'The whole UK'
  const english = all.filter((region) => REGIONS[region].startsWith('E12'))
  if (english.every((region) => regions.includes(region))) {
    return ['England', ...regions.filter((region) => !english.includes(region)).map(plain)].join(', ')
  }
  return regions.map(plain).join(', ')
}

// What the source says, in its own words, for a field it gives.
export function sourceSays (entry: Entry, field: Field): string {
  const f = entry.fields
  switch (field) {
    case 'type':
      if (entry.source === 'find-a-grant') return 'Grant'
      return entry.source === 'govuk-finder' ? list(f.types_of_support).map(plain).join(', ') : list(f.categories).join(', ')
    case 'provider':
      return entry.provider ?? ''
    case 'amounts':
      if (entry.source === 'find-a-grant') {
        const pounds = (amount: Value) => typeof amount === 'number' ? `£${amount.toLocaleString('en-GB')}` : 'not given'
        return `From ${pounds(f.minimum_award ?? null)} to ${pounds(f.maximum_award ?? null)}`
      }
      return String(f.grant_size ?? '')
    case 'closes_on':
      return entry.source === 'find-a-grant' ? String(f.closing_date ?? '').slice(0, 10) : String(f.deadline ?? '')
    case 'status':
      return entry.source === 'find-a-grant' ? `Listed as open (opens ${String(f.opening_date ?? 'not given').slice(0, 10)})` : String(f.status ?? '')
    case 'areas':
      if (entry.source === 'govuk-finder') return govukAreas(list(f.regions))
      return list(entry.source === 'north-east-growth-hub' ? f.area : f.location).join(', ')
    case 'business_stages':
      return entry.source === 'govuk-finder' ? list(f.business_stages).map(plain).join(', ') : list(f.business_stage).join(', ')
    case 'sectors':
      if (entry.source === 'govuk-finder') return words(list(f.industries), Object.keys(GOVUK_INDUSTRIES), 'Every industry').split(', ').map(plain).join(', ')
      return words(list(f.sector).filter((sector) => sector !== 'Export'), Object.keys(TEES_VALLEY_SECTORS), 'Every sector')
    case 'who_can_apply':
      return list(f.applicant_types ?? f.open_to).join(', ')
    default:
      return ''
  }
}

export function checkRows (entries: Entry[], readOn: string): CheckRow[] {
  const rows: CheckRow[] = []
  let check = 0
  for (const entry of entries) {
    const mapped = mapEntry(entry, readOn)
    // Find a Grant gives no link to the running body's own page, only where
    // to apply, which is usually its own application form behind a sign-in.
    // The department that runs the grant writes the advert, so the advert is
    // the page to check against.
    const advertOnly = entry.source === 'find-a-grant'
    const base = {
      source: SOURCE_NAMES[entry.source],
      scheme: entry.name,
      sourcePage: entry.page,
      runningBodyPage: advertOnly
        ? 'Application link only: use the advert on Find a Grant instead'
        : entry.providerPage ?? entry.applyPage ?? 'None given: search for the scheme'
    }
    const add = (question: string, says: string) => rows.push({ check: ++check, ...base, question, sourceSays: says })

    // Every entry: whether the page it links to is the scheme's own, and
    // whether the scheme is still running.
    if (advertOnly) add('The advert on Find a Grant works and is about this scheme', entry.page)
    else add('The running body\'s page is the scheme\'s own page and works', base.runningBodyPage)
    add('The scheme is still running', 'Listed on the source')
    for (const [field, question] of Object.entries(QUESTIONS) as Array<[Field, string]>) {
      if (mapped.fields[field].how !== 'coded') continue
      const says = sourceSays(entry, field)
      if (says !== '') add(question, says)
    }
  }
  return rows
}

function csvCell (value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function checklistCsv (rows: CheckRow[]): string {
  const header = ['Check', 'Source', 'Scheme', 'Entry on the source', 'Running body\'s page', 'What to check', 'The source says', `Result (${RESULTS})`, 'What the page says, if different', 'Notes']
  const lines = [header, ...rows.map((row) => [row.check, row.source, row.scheme, row.sourcePage, row.runningBodyPage, row.question, row.sourceSays, '', '', ''])]
  // The byte order mark makes Excel read the file as UTF-8, so £ shows.
  return `﻿${lines.map((cells) => cells.map(csvCell).join(',')).join('\r\n')}\r\n`
}

function latest (): string {
  const dates = fs.readdirSync(OUTPUT).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()
  if (dates.length === 0) throw new Error('There is no collection to check. Run npm run spike:collect first.')
  return dates[dates.length - 1]
}

function main (): void {
  const at = process.argv.indexOf('--date')
  const date = at < 0 ? latest() : process.argv[at + 1]
  const folder = path.join(OUTPUT, date)
  const rows: CheckRow[] = []
  for (const source of SOURCES) {
    const file = path.join(folder, `${source}.json`)
    if (!fs.existsSync(file)) continue
    const collection = JSON.parse(fs.readFileSync(file, 'utf8')) as Collection
    const picked = sample(collection.entries)
    const sourceRows = checkRows(picked, collection.readOn).map((row) => ({ ...row, check: rows.length + row.check }))
    rows.push(...sourceRows)
    console.log(`${SOURCE_NAMES[source]}: ${picked.length} entries, ${sourceRows.length} checks`)
  }
  const out = path.join(folder, `quality-checklist-${date}.csv`)
  fs.writeFileSync(out, checklistCsv(rows))
  console.log(`${rows.length} checks in ${path.relative(process.cwd(), out)}`)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
