import fs from 'node:fs'
import path from 'node:path'
import { OUTPUT } from './collect'
import type { Collection, Entry, SourceName } from './entry'
import { coverage, FIELDS, isFunding, mapEntry, type Field, type Mapped } from './map'

// Maps a day's collection to the funding data API's fields and writes how
// each field could be filled, source by source.
//
//   npm run spike:map
//   npm run spike:map -- --date 2026-11-20
//
// It reads spike/ff-121/output/<date>/<source>.json and writes, in the same
// folder, mapped/<source>.json and coverage.md. It makes no requests.

const SOURCES: SourceName[] = ['govuk-finder', 'find-a-grant', 'north-east-growth-hub', 'tees-valley']

const SHORT: Record<SourceName, string> = {
  'govuk-finder': 'GOV.UK finder',
  'find-a-grant': 'Find a Grant',
  'north-east-growth-hub': 'Growth Hub',
  'tees-valley': 'Tees Valley'
}

function latest (): string {
  const dates = fs.readdirSync(OUTPUT).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()
  if (dates.length === 0) throw new Error('There is no collection to map. Run npm run spike:collect first.')
  return dates[dates.length - 1]
}

function table (groups: Map<SourceName, Mapped[]>): string[] {
  const sources = [...groups.keys()]
  const counts = new Map(sources.map((source) => [source, coverage(groups.get(source) ?? [])]))
  const lines = [
    `| Field | ${sources.map((source) => `${SHORT[source]} (${groups.get(source)?.length ?? 0})`).join(' | ')} |`,
    `| --- | ${sources.map(() => '---').join(' | ')} |`
  ]
  for (const field of Object.keys(FIELDS) as Field[]) {
    const cells = sources.map((source) => {
      const { coded, text, none } = counts.get(source)![field]
      return `${coded} / ${text} / ${none}`
    })
    lines.push(`| ${FIELDS[field]} | ${cells.join(' | ')} |`)
  }
  return lines
}

function unmapped (mapped: Mapped[]): string[] {
  const seen = new Map<string, number>()
  for (const one of mapped) {
    for (const [field, cell] of Object.entries(one.fields)) {
      for (const value of cell.unmapped ?? []) {
        const key = `${SHORT[one.source]}, ${FIELDS[field as Field]}: ${value}`
        seen.set(key, (seen.get(key) ?? 0) + 1)
      }
    }
  }
  return [...seen].map(([key, count]) => `- ${key} (${count})`)
}

function duplicates (entries: Entry[]): string[] {
  const byName = new Map<string, Entry[]>()
  for (const entry of entries) {
    const key = `${entry.source} ${entry.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`
    byName.set(key, [...(byName.get(key) ?? []), entry])
  }
  return [...byName.values()].filter((same) => same.length > 1)
    .map((same) => `- ${SHORT[same[0].source]}: "${same[0].name}" is listed ${same.length} times (${same.map((one) => one.id).join(', ')})`)
}

export function coverageReport (date: string, collections: Collection[]): { markdown: string, mapped: Map<SourceName, Mapped[]> } {
  const mapped = new Map<SourceName, Mapped[]>()
  const funding = new Map<SourceName, Mapped[]>()
  const grants = new Map<SourceName, Mapped[]>()
  for (const collection of collections) {
    const all = collection.entries.map((entry) => mapEntry(entry, collection.readOn))
    mapped.set(collection.source, all)
    const fundingEntries = all.filter((_, at) => isFunding(collection.entries[at]))
    funding.set(collection.source, fundingEntries)
    grants.set(collection.source, fundingEntries.filter((one) => one.grant))
  }

  const entries = collections.flatMap((collection) => collection.entries)
  const all = [...mapped.values()].flat()
  const markdown = [
    `# FF-121 field coverage, ${date}`,
    '',
    'How each of the funding data API\'s fields could be filled from each source, for the North East entries read on this date. Each cell is **coded / text / none**:',
    '',
    '- **coded**: from a coded value or labelled field, mapped by the tables in `spike/ff-121/mapping.ts`',
    '- **text**: not in a field, but the entry\'s text may say it, so a person would have to read it. Decided by simple word patterns, so it shows where a value might be, not that it is there',
    '- **none**: the source does not give it',
    '',
    'Tees Valley does not say which entries are grants, so its grants are the funding entries whose name or text mentions a grant.',
    '',
    '## Grants',
    '',
    ...table(grants),
    '',
    '## All funding entries',
    '',
    'Grants, loans, equity and general finance, leaving out advice and other support.',
    '',
    ...table(funding),
    '',
    '## Values with no mapping',
    '',
    ...(unmapped(all).length > 0 ? unmapped(all) : ['None.']),
    '',
    '## Listed more than once',
    '',
    ...(duplicates(entries).length > 0 ? duplicates(entries) : ['None.']),
    ''
  ].join('\n')

  return { markdown, mapped }
}

function main (): void {
  const at = process.argv.indexOf('--date')
  const date = at < 0 ? latest() : process.argv[at + 1]
  const folder = path.join(OUTPUT, date)
  const collections = SOURCES
    .filter((source) => fs.existsSync(path.join(folder, `${source}.json`)))
    .map((source) => JSON.parse(fs.readFileSync(path.join(folder, `${source}.json`), 'utf8')) as Collection)
  if (collections.length === 0) throw new Error(`There is no collection in ${folder}.`)

  const { markdown, mapped } = coverageReport(date, collections)
  fs.mkdirSync(path.join(folder, 'mapped'), { recursive: true })
  for (const [source, entries] of mapped) {
    fs.writeFileSync(path.join(folder, 'mapped', `${source}.json`), `${JSON.stringify(entries, null, 2)}\n`)
  }
  fs.writeFileSync(path.join(folder, 'coverage.md'), markdown)
  console.log(markdown)
}

if (require.main === module) {
  try {
    main()
  } catch (error) {
    console.error((error as Error).message)
    process.exit(1)
  }
}
