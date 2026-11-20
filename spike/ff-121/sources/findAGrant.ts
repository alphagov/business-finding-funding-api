import { fingerprint, getText, type Get } from '../http'
import { decode, withoutEmails } from '../text'
import type { Collection, Entry, Keep, Value } from '../entry'

// Find a Grant, which lists open central government grants. Its pages carry
// their data as JSON for the page's own script, so the spike reads that
// rather than the markup. The listing is filtered to North East England; each
// grant's own page adds its eligibility, dates and application link.

const BASE = 'https://www.find-government-grants.service.gov.uk'
const NORTH_EAST = '4'
const PAGE_SIZE = 10

export interface ListedGrant {
  label: string
  grantName: string
  grantFunder?: string
  grantLocation?: string[]
  grantApplicantType?: string[]
  grantMinimumAward?: number
  grantMaximumAward?: number
  grantTotalAwardAmount?: number
  grantApplicationOpenDate?: string
  grantApplicationCloseDate?: string
  grantShortDescription?: string
}

interface RichText {
  value?: string
  nodeType?: string
  content?: RichText[]
}

export interface GrantDetail {
  sys?: { updatedAt?: string }
  fields: ListedGrant & {
    grantWebpageUrl?: string
    grantSummaryTab?: RichText
    grantEligibilityTab?: RichText
    grantObjectivesTab?: RichText
    grantDatesTab?: RichText
    grantApplyTab?: RichText
    grantSupportingInfoTab?: RichText
  }
}

const TABS: Array<[keyof GrantDetail['fields'], string]> = [
  ['grantSummaryTab', 'Summary'],
  ['grantEligibilityTab', 'Eligibility'],
  ['grantObjectivesTab', 'Objectives'],
  ['grantDatesTab', 'Dates'],
  ['grantApplyTab', 'How to apply'],
  ['grantSupportingInfoTab', 'Supporting information']
]

export function listingUrl (page: number): string {
  const query = new URLSearchParams({
    'fields.grantLocation.en-US': NORTH_EAST,
    skip: String((page - 1) * PAGE_SIZE),
    limit: String(PAGE_SIZE),
    page: String(page)
  })
  return `${BASE}/grants?${query.toString()}`
}

// The JSON a Next.js page carries for its own script.
export function pageData (html: string): Record<string, unknown> {
  const match = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(html)
  if (match === null) throw new Error('The page has no page data. It may have changed shape.')
  const data = JSON.parse(match[1]) as { props?: { pageProps?: Record<string, unknown> } }
  return data.props?.pageProps ?? {}
}

export function richText (node: RichText | undefined): string {
  if (node === undefined) return ''
  if (typeof node.value === 'string') return node.value
  const inner = (node.content ?? []).map(richText)
  const block = ['paragraph', 'list-item', 'heading-1', 'heading-2', 'heading-3', 'heading-4'].includes(node.nodeType ?? '')
  return block ? `${inner.join('')}\n` : inner.join('')
}

export function grantEntry (listed: ListedGrant, detail: GrantDetail | null, detailText: string | null): Entry {
  const grant = detail?.fields ?? listed
  const fields: Record<string, Value> = {
    funder: grant.grantFunder ?? null,
    location: grant.grantLocation ?? [],
    applicant_types: grant.grantApplicantType ?? [],
    minimum_award: grant.grantMinimumAward ?? null,
    maximum_award: grant.grantMaximumAward ?? null,
    total_award: grant.grantTotalAwardAmount ?? null,
    opening_date: grant.grantApplicationOpenDate ?? null,
    closing_date: grant.grantApplicationCloseDate ?? null,
    short_description: grant.grantShortDescription ?? null,
    // The listing's own copy of the dates, which can differ from the grant's
    // page. The spike reports where they do.
    listing_opening_date: listed.grantApplicationOpenDate ?? null,
    listing_closing_date: listed.grantApplicationCloseDate ?? null
  }
  const text = detail === null
    ? ''
    : TABS.map(([tab, heading]) => [heading, richText(detail.fields[tab] as RichText | undefined).trim()])
      .filter(([, body]) => body !== '')
      .map(([heading, body]) => `${heading}\n${body}`)
      .join('\n\n')

  return {
    source: 'find-a-grant',
    id: listed.label,
    name: decode(grant.grantName),
    page: `${BASE}/grants/${listed.label}`,
    read: detail === null ? 'listing only' : 'page',
    provider: grant.grantFunder ?? null,
    // Find a Grant links to the application, which is sometimes the funder's
    // own page and sometimes the Find a Grant application form.
    providerPage: null,
    applyPage: detail?.fields.grantWebpageUrl ?? null,
    updated: detail?.sys?.updatedAt ?? null,
    fields,
    text: withoutEmails(text),
    fingerprint: detailText === null ? null : fingerprint(detailText)
  }
}

export async function collectFindAGrant (get: Get, keep: Keep, readOn: string): Promise<Omit<Collection, 'requests'>> {
  const listed: ListedGrant[] = []
  for (let page = 1; ; page += 1) {
    const data = pageData(await getText(get, listingUrl(page)))
    keep(`listing-${page}.json`, withoutEmails(JSON.stringify(data, null, 2)))
    const results = (data.searchResult ?? []) as ListedGrant[]
    listed.push(...results)
    const total = Number(data.totalGrants ?? 0)
    if (results.length === 0 || listed.length >= total) break
  }

  const entries: Entry[] = []
  const problems: string[] = []
  for (const grant of listed) {
    try {
      const html = await getText(get, `${BASE}/grants/${grant.label}`)
      const detail = pageData(html).grantDetail as GrantDetail | undefined
      if (detail?.fields === undefined) throw new Error('The page has no grant details.')
      keep(`grant-${grant.label}.json`, withoutEmails(JSON.stringify(detail, null, 2)))
      entries.push(grantEntry(grant, detail, html))
    } catch (error) {
      problems.push(`${grant.label}: ${(error as Error).message}`)
      entries.push(grantEntry(grant, null, null))
    }
  }

  return { source: 'find-a-grant', label: 'Find a Grant', readOn, entries, problems }
}
