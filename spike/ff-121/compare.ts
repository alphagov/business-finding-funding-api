import fs from 'node:fs'
import path from 'node:path'
import readXlsxFile from 'read-excel-file/node'
import { OUTPUT } from './collect'
import type { Collection, Entry, SourceName } from './entry'
import { isFunding, isGrant } from './map'
import { NORTH_EAST_COUNCILS } from './mapping'

// Days 4 and 5 of the spike: which schemes on the team's list of North East
// funding (September 2026) the four sources have, which they do not, and
// which they have that the list does not. Also which of the schemes the
// funding data API publishes now they have.
//
//   npm run spike:compare -- --list "path/to/NORTH EAST ENGLAND GRANTS AND FUNDING.xlsx"
//   npm run spike:compare -- --list "path/to/list.xlsx" --discovered path/to/data-blind/discovery/candidates.json
//
// With --discovered, it also compares the sources with the schemes TPX's AI
// search found in its blind run, from the prototype's run data.
//
// The team's list names the people who checked each scheme, so it must be
// kept outside this public repository: the script refuses a path inside it,
// reads only the columns it needs, and writes its results to the output
// folder, which git ignores.

const REPOSITORY = path.join(__dirname, '..', '..')
const PUBLISHED = path.join(REPOSITORY, 'data', 'one-platform-schemes.json')

const SOURCES: SourceName[] = ['govuk-finder', 'find-a-grant', 'north-east-growth-hub', 'tees-valley']

export interface Scheme {
  // Where the scheme is listed: a sheet of the team's list, or the API.
  list: string
  id: string
  name: string
  category: string
  provider: string
  link: string
  grant: boolean
  status?: string
  verification?: string
}

// The sheets of the team's list that hold schemes, by the start of their
// names, which have spelling slips such as "oppotunities".
const SHEETS = ['master list', 'local council', 'national funding', 'wider support']
const ID = /^[A-Z]{1,3}-?\d+$/

function heading (value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase()
}

function cell (cells: unknown[], at: number): string {
  return at < 0 ? '' : String(cells[at] ?? '').trim()
}

export async function readTeamList (file: string): Promise<Scheme[]> {
  const inside = path.relative(REPOSITORY, path.resolve(file))
  if (!inside.startsWith('..') && !path.isAbsolute(inside)) {
    throw new Error('The team\'s list names people, so keep it outside this repository and give its path there.')
  }

  const schemes: Scheme[] = []
  for (const { sheet, data } of await readXlsxFile(file)) {
    if (!SHEETS.some((start) => sheet.toLowerCase().startsWith(start))) continue
    const rows = data as unknown[][]
    const top = rows.findIndex((cells) => cells.some((value) => heading(value) === 'id'))
    if (top < 0) continue
    const names = rows[top].map(heading)
    // The first column with each heading. Wider support repeats its headings
    // in a second table to the right.
    const at = (...headings: string[]) => names.findIndex((name) => headings.includes(name))
    const columns = {
      id: at('id'),
      name: at('scheme name', 'programme name'),
      category: at('category'),
      provider: at('provider / manager'),
      link: at('official link'),
      status: at('status'),
      verification: at('verification')
    }

    for (const cells of rows.slice(top + 1)) {
      const id = cell(cells, columns.id)
      const name = cell(cells, columns.name)
      if (!ID.test(id) || name === '') continue
      const category = cell(cells, columns.category)
      schemes.push({
        list: sheet.trim(),
        id,
        name,
        category,
        provider: cell(cells, columns.provider),
        link: cell(cells, columns.link),
        grant: /grant/i.test(category),
        status: cell(cells, columns.status) || undefined,
        verification: cell(cells, columns.verification) || undefined
      })
    }
  }
  return schemes
}

interface PublishedRow {
  values: Record<string, string | number | boolean | null>
}

// The schemes the funding data API publishes now that a North East business
// could use: national ones, and those for England, the North East or its
// council areas.
export function publishedForNorthEast (rows: PublishedRow[]): Scheme[] {
  const local = new Set(['E92000001', 'E12000001', ...Object.values(NORTH_EAST_COUNCILS)])
  return rows
    .filter(({ values }) => {
      const codes = String(values.area_codes ?? '').split('|').map((code) => code.trim().toUpperCase())
      return values.area_level === 'national' || codes.some((code) => code.startsWith('K0') || local.has(code))
    })
    .map(({ values }) => ({
      list: 'Funding data API',
      id: String(values.scheme_id ?? ''),
      name: String(values.scheme_name ?? ''),
      category: String(values.help_type ?? ''),
      provider: String(values.provider_name ?? ''),
      link: String(values.source_url ?? ''),
      grant: String(values.help_type ?? '').toUpperCase() === 'GRANT'
    }))
}

// An address without its scheme, "www.", query, fragment or final slash, or
// null if it is a home page or not a web address, as those name a provider
// rather than a scheme.
export function addressKey (address: string | null): string | null {
  if (address === null) return null
  try {
    const url = new URL(address.trim())
    if (!url.protocol.startsWith('http')) return null
    const route = url.pathname.replace(/\/+$/, '').toLowerCase()
    if (route === '') return null
    return `${url.hostname.replace(/^www\./, '').toLowerCase()}${route}`
  } catch {
    return null
  }
}

const SMALL_WORDS = new Set(['a', 'an', 'and', 'by', 'for', 'in', 'of', 'on', 'the', 'to', 'with'])

export function nameWords (name: string): Set<string> {
  return new Set(name.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((word) => word !== '' && !SMALL_WORDS.has(word)))
}

// Words many scheme names share, which say nothing about which scheme it is.
const GENERIC_WORDS = new Set([
  'north', 'east', 'northeast', 'england', 'uk', 'national', 'regional', 'business', 'businesses',
  'fund', 'funds', 'funding', 'grant', 'grants', 'loan', 'loans', 'scheme', 'schemes', 'programme',
  'program', 'support', 'service', 'services', 'investment', 'finance'
])

// How alike two names are, from 0 (not the same scheme) to 1 (the same
// words). Names are the same scheme if they share at least one word that is
// not generic, and:
//
// - they have the same words
// - or most of the same words (a Dice score of 0.8 or more), when both have
//   at least two
// - or, when the shorter has at least three words, 80% of them are in the
//   longer name and the longer is no more than twice as long, as in
//   "Woodland Creation Planning Grant" and "Trees, woodlands and forestry -
//   Woodland Creation Planning Grant"
//
// A name is also tried without the words in brackets, which are often an
// acronym or the provider. Matches by name can be wrong, so they are listed
// for a person to check.
export function nameScore (one: string, other: string): number {
  const forms = (name: string) => [name, name.replace(/\([^)]*\)/g, ' ')]
  let best = 0
  for (const a of forms(one)) {
    for (const b of forms(other)) {
      const left = nameWords(a)
      const right = nameWords(b)
      const shared = [...left].filter((word) => right.has(word))
      if (!shared.some((word) => !GENERIC_WORDS.has(word))) continue
      const dice = (2 * shared.length) / (left.size + right.size)
      const shorter = Math.min(left.size, right.size)
      const longer = Math.max(left.size, right.size)
      const alike = dice === 1 ||
        (shorter >= 2 && dice >= 0.8) ||
        (shorter >= 3 && shared.length / shorter >= 0.8 && shared.length / longer >= 0.5)
      if (alike) best = Math.max(best, dice)
    }
  }
  return best
}

export function sameName (one: string, other: string): boolean {
  return nameScore(one, other) > 0
}

export interface Match {
  source: SourceName
  entry: string
  by: 'address' | 'name'
}

// Addresses more than one scheme on a list links to, such as a directory's
// own list page. They do not identify a scheme, so they are not matched on.
export function sharedAddresses (schemes: Scheme[]): Set<string> {
  const seen = new Map<string, number>()
  for (const scheme of schemes) {
    const key = addressKey(scheme.link)
    if (key !== null) seen.set(key, (seen.get(key) ?? 0) + 1)
  }
  return new Set([...seen].filter(([, count]) => count > 1).map(([key]) => key))
}

// Anything a scheme can be matched with: a source's entry or a candidate from
// TPX's search.
export interface Listed {
  id: string
  name: string
  addresses: Array<string | null>
}

// The item for the same scheme: the first at the scheme's address, or else
// the closest name, not the first, as a list may have a programme and its
// parts.
export function closest (scheme: Scheme, items: Listed[], shared: Set<string> = new Set()): { id: string, by: 'address' | 'name' } | null {
  const linked = addressKey(scheme.link)
  const key = linked !== null && shared.has(linked) ? null : linked
  const byAddress = key === null ? undefined : items.find((item) => item.addresses.some((address) => addressKey(address) === key))
  if (byAddress !== undefined) return { id: byAddress.id, by: 'address' }
  const scored = items.map((item) => ({ item, score: nameScore(item.name, scheme.name) })).filter(({ score }) => score > 0)
  const byName = scored.sort((a, b) => b.score - a.score)[0]?.item
  return byName === undefined ? null : { id: byName.id, by: 'name' }
}

export function matchScheme (scheme: Scheme, entries: Entry[], shared: Set<string> = new Set()): Match[] {
  const matches: Match[] = []
  for (const source of SOURCES) {
    const items = entries.filter((entry) => entry.source === source)
      .map((entry) => ({ id: entry.id, name: entry.name, addresses: [entry.page, entry.providerPage, entry.applyPage] }))
    const found = closest(scheme, items, shared)
    if (found !== null) matches.push({ source, entry: found.id, by: found.by })
  }
  return matches
}

// A scheme TPX's AI search found (data-blind/discovery/candidates.json in
// the prototype's run data), with whether its page worked when TPX checked.
export interface Discovered extends Listed {
  provider: string
  kind: string
  area: string
  link: string
  worked: boolean
}

interface Candidate {
  id: string
  name: string
  running_body?: string
  kind?: string
  area?: string
  addresses?: string[]
  best?: { address?: string, fetch_status?: number | null }
}

export function readDiscovered (file: string): Discovered[] {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as { candidates?: Candidate[] }
  if (!Array.isArray(data.candidates)) throw new Error(`${file} has no candidates. Give TPX's discovery/candidates.json.`)
  return data.candidates.map((candidate) => ({
    id: candidate.id,
    name: candidate.name,
    provider: candidate.running_body ?? '',
    kind: candidate.kind ?? '',
    area: candidate.area ?? '',
    link: candidate.best?.address ?? candidate.addresses?.[0] ?? '',
    addresses: candidate.addresses ?? [],
    worked: candidate.best?.fetch_status === 200
  }))
}

export function asScheme (found: Discovered): Scheme {
  return { list: 'TPX search', id: found.id, name: found.name, category: found.kind, provider: found.provider, link: found.link, grant: found.kind === 'grant' }
}

function host (link: string): string {
  if (link.startsWith('mailto:')) return 'an email address'
  try {
    return new URL(link).hostname.replace(/^www\./, '') || 'no web address'
  } catch {
    return 'no web address'
  }
}

function percent (part: number, whole: number): string {
  return whole === 0 ? '0%' : `${Math.round((100 * part) / whole)}%`
}

const SHORT: Record<SourceName, string> = {
  'govuk-finder': 'GOV.UK finder',
  'find-a-grant': 'Find a Grant',
  'north-east-growth-hub': 'Growth Hub',
  'tees-valley': 'Tees Valley'
}

function counted (items: string[]): string[] {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).map(([item, count]) => `${item} (${count})`)
}

// How the four sources and TPX's search compare, for TPX's candidates and
// for the team's list.
export function withDiscovery (team: Scheme[], discovered: Discovered[], entries: Entry[]): string[] {
  const teamShared = sharedAddresses(team)
  const inSources = new Map(team.map((scheme) => [scheme, matchScheme(scheme, entries, teamShared).length > 0]))
  const inSearch = new Map(team.map((scheme) => [scheme, closest(scheme, discovered, teamShared) !== null]))

  const candidates = discovered.map(asScheme)
  const candidateShared = sharedAddresses(candidates)
  const candidateInSources = new Map(discovered.map((found, at) => [found, matchScheme(candidates[at], entries, candidateShared).length > 0]))

  const candidateRow = (label: string, list: Discovered[]) => {
    const worked = list.filter((found) => found.worked).length
    const inAny = list.filter((found) => candidateInSources.get(found)).length
    return `| ${label} | ${list.length} | ${worked} (${percent(worked, list.length)}) | ${inAny} (${percent(inAny, list.length)}) |`
  }

  const teamRow = (label: string, schemes: Scheme[]) => {
    const count = (test: (scheme: Scheme) => boolean) => schemes.filter(test).length
    const sources = (scheme: Scheme) => inSources.get(scheme) === true
    const search = (scheme: Scheme) => inSearch.get(scheme) === true
    return `| ${label} | ${schemes.length} | ${count(sources)} | ${count(search)} | ${count((one) => sources(one) || search(one))} | ${count((one) => sources(one) && search(one))} | ${count((one) => sources(one) && !search(one))} | ${count((one) => search(one) && !sources(one))} | ${count((one) => !sources(one) && !search(one))} |`
  }

  return [
    '## TPX\'s AI search',
    '',
    `TPX's blind run of 28 September found ${discovered.length} candidate schemes, almost all through Gemini, as TPX's directory reader failed on most directories. "Working page" is whether the candidate's page gave a reply when TPX checked it.`,
    '',
    '| TPX\'s candidates | Candidates | Working page then | In any of the four sources |',
    '| --- | --- | --- | --- |',
    candidateRow('All', discovered),
    candidateRow('Grants', discovered.filter((found) => found.kind === 'grant')),
    '',
    '## The team\'s list: the four sources and TPX\'s search together',
    '',
    'TPX reported that its search found about 95 of the team\'s 154 schemes.',
    '',
    '| Team\'s list | Schemes | Four sources | TPX\'s search | Either | Both | Sources only | Search only | Neither |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    teamRow('All schemes', team),
    teamRow('Grants', team.filter((scheme) => scheme.grant)),
    ...[...new Set(team.map((scheme) => scheme.list))].map((list) => teamRow(list, team.filter((scheme) => scheme.list === list))),
    ''
  ]
}

export function comparison (date: string, team: Scheme[], published: Scheme[], entries: Entry[], discovered: Discovered[] = []): string {
  const teamShared = sharedAddresses(team)
  const found = new Map(team.map((scheme) => [scheme, matchScheme(scheme, entries, teamShared)]))
  const publishedFound = new Map(published.map((scheme) => [scheme, matchScheme(scheme, entries, sharedAddresses(published))]))
  const entryName = new Map(entries.map((entry) => [`${entry.source} ${entry.id}`, entry.name]))
  const lists = [...new Set(team.map((scheme) => scheme.list))]

  const row = (label: string, schemes: Scheme[]) => {
    const inAny = schemes.filter((scheme) => found.get(scheme)!.length > 0).length
    const bySource = SOURCES.map((source) => schemes.filter((scheme) => found.get(scheme)!.some((match) => match.source === source)).length)
    return `| ${label} | ${schemes.length} | ${inAny} (${percent(inAny, schemes.length)}) | ${bySource.join(' | ')} |`
  }
  const header = [
    `| Team's list | Schemes | In any source | ${SOURCES.map((source) => SHORT[source]).join(' | ')} |`,
    `| --- | --- | --- | ${SOURCES.map(() => '---').join(' | ')} |`
  ]

  // Entries in each source that match nothing on the team's list.
  const matched = new Set([...found.values()].flat().map((match) => `${match.source} ${match.entry}`))
  const extra = (filter: (entry: Entry) => boolean) => SOURCES.map((source) => {
    const ofSource = entries.filter((entry) => entry.source === source && filter(entry))
    const unmatched = ofSource.filter((entry) => !matched.has(`${source} ${entry.id}`))
    return `| ${SHORT[source]} | ${ofSource.length} | ${unmatched.length} |`
  })

  const missingGrants = team.filter((scheme) => scheme.grant && found.get(scheme)!.length === 0)
  const missing = team.filter((scheme) => found.get(scheme)!.length === 0)
  const allMatches = [...found.values()].flat()

  return [
    `# FF-121 comparison with the team's list, ${date}`,
    '',
    'The four sources as read on this date, against the team\'s "North East England grants and funding" list of September 2026. A scheme is found if a source has an entry at the same address, or failing that with the same or nearly the same name. Home pages are not used to match, as they name a provider rather than a scheme.',
    '',
    `${allMatches.filter((match) => match.by === 'address').length} matches were by address and ${allMatches.filter((match) => match.by === 'name').length} by name. Matches by name are listed at the end for a person to check. ${teamShared.size} addresses on the team's list are shared by more than one scheme, such as a directory's own list page, so they were not matched on.`,
    '',
    '## How much of the team\'s list the sources have',
    '',
    ...header,
    row('All schemes', team),
    row('Grants', team.filter((scheme) => scheme.grant)),
    ...lists.map((list) => row(list, team.filter((scheme) => scheme.list === list))),
    '',
    '## Team\'s schemes no source has',
    '',
    `${missing.length} of ${team.length}. Where their links on the team's list point:`,
    '',
    ...counted(missing.map((scheme) => host(scheme.link))).slice(0, 15).map((line) => `- ${line}`),
    '',
    `### The ${missingGrants.length} grants`,
    '',
    '| Team ID | Scheme | Provider | Link |',
    '| --- | --- | --- | --- |',
    ...missingGrants.map((scheme) => `| ${scheme.id} | ${scheme.name} | ${scheme.provider} | ${host(scheme.link)} |`),
    '',
    '## Entries in the sources that are not on the team\'s list',
    '',
    'These may be schemes the team missed, or national schemes, advice or other support the team left out. A person would need to check them.',
    '',
    '| Source | Funding entries | Not on the team\'s list |',
    '| --- | --- | --- |',
    ...extra(isFunding),
    '',
    '| Source | Grants | Not on the team\'s list |',
    '| --- | --- | --- |',
    ...extra((entry) => isFunding(entry) && isGrant(entry).grant),
    '',
    '## Schemes the funding data API publishes now',
    '',
    `${published.length} of the API's schemes could be used by a North East business (national, England or North East). ${[...publishedFound.values()].filter((matches) => matches.length > 0).length} are in at least one source.`,
    '',
    '| Scheme | Found in |',
    '| --- | --- |',
    ...published.map((scheme) => `| ${scheme.name} | ${publishedFound.get(scheme)!.map((match) => `${SHORT[match.source]} (${match.by})`).join(', ') || 'none'} |`),
    '',
    ...(discovered.length > 0 ? withDiscovery(team, discovered, entries) : []),
    '## Matches by name, to check',
    '',
    '| Team ID | Team\'s name | Source | Source\'s name |',
    '| --- | --- | --- | --- |',
    ...team.flatMap((scheme) => found.get(scheme)!.filter((match) => match.by === 'name')
      .map((match) => `| ${scheme.id} | ${scheme.name} | ${SHORT[match.source]} | ${entryName.get(`${match.source} ${match.entry}`) ?? match.entry} |`)),
    ''
  ].join('\n')
}

function latest (): string {
  const dates = fs.readdirSync(OUTPUT).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort()
  if (dates.length === 0) throw new Error('There is no collection to compare. Run npm run spike:collect first.')
  return dates[dates.length - 1]
}

async function main (): Promise<void> {
  const args = process.argv.slice(2)
  const option = (name: string) => {
    const at = args.indexOf(name)
    return at < 0 ? undefined : args[at + 1]
  }
  const list = option('--list')
  if (list === undefined) throw new Error('Give the path to the team\'s list with --list "path/to/list.xlsx".')
  const date = option('--date') ?? latest()
  const folder = path.join(OUTPUT, date)

  const entries = SOURCES
    .filter((source) => fs.existsSync(path.join(folder, `${source}.json`)))
    .flatMap((source) => (JSON.parse(fs.readFileSync(path.join(folder, `${source}.json`), 'utf8')) as Collection).entries)
  const team = await readTeamList(list)
  const published = publishedForNorthEast((JSON.parse(fs.readFileSync(PUBLISHED, 'utf8')) as { rows: PublishedRow[] }).rows)
  const searched = option('--discovered')
  const discovered = searched === undefined ? [] : readDiscovered(searched)

  const markdown = comparison(date, team, published, entries, discovered)
  fs.writeFileSync(path.join(folder, 'comparison.md'), markdown)
  console.log(markdown)
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error((error as Error).message)
    process.exit(1)
  })
}
