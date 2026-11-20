import { fingerprint, getText, type Get } from '../http'
import { textOf, withoutEmails } from '../text'
import type { Collection, Entry, Keep } from '../entry'

// The GOV.UK business finance support finder, read through the GOV.UK Search
// API (every scheme tagged with the North East) and the Content API (each
// scheme's link to the running body's page, and its text). Both are public
// data under the Open Government Licence.

const SEARCH = 'https://www.gov.uk/api/search.json'
const CONTENT = 'https://www.gov.uk/api/content'
const PAGE_SIZE = 100
const FIELDS = ['title', 'link', 'description', 'business_sizes', 'business_stages', 'industries', 'regions', 'types_of_support', 'public_timestamp', 'organisations']

export interface SearchResult {
  title: string
  link: string
  description?: string
  business_sizes?: string[]
  business_stages?: string[]
  industries?: string[]
  regions?: string[]
  types_of_support?: string[]
  public_timestamp?: string
  organisations?: Array<{ title?: string }>
}

export interface ContentItem {
  public_updated_at?: string
  details?: {
    body?: string
    metadata?: {
      continuation_link?: string
      will_continue_on?: string
    }
  }
}

export function searchUrl (start: number): string {
  const query = new URLSearchParams({
    filter_content_store_document_type: 'business_finance_support_scheme',
    filter_regions: 'north-east',
    count: String(PAGE_SIZE),
    start: String(start),
    fields: FIELDS.join(',')
  })
  return `${SEARCH}?${query.toString()}`
}

export function govukEntry (result: SearchResult, content: ContentItem | null, contentText: string | null): Entry {
  return {
    source: 'govuk-finder',
    id: result.link,
    name: result.title,
    page: `https://www.gov.uk${result.link}`,
    read: content === null ? 'listing only' : 'page',
    // GOV.UK names the organisation that published the entry, which is often
    // not the body that runs the scheme, so it is kept as a field instead.
    provider: null,
    providerPage: content?.details?.metadata?.continuation_link ?? null,
    applyPage: null,
    updated: content?.public_updated_at ?? result.public_timestamp ?? null,
    fields: {
      description: result.description ?? null,
      publisher: (result.organisations ?? []).map((one) => one.title ?? '').filter((one) => one !== ''),
      regions: result.regions ?? [],
      business_sizes: result.business_sizes ?? [],
      business_stages: result.business_stages ?? [],
      industries: result.industries ?? [],
      types_of_support: result.types_of_support ?? [],
      will_continue_on: content?.details?.metadata?.will_continue_on ?? null
    },
    text: withoutEmails(textOf(content?.details?.body ?? '')),
    fingerprint: contentText === null ? null : fingerprint(contentText)
  }
}

export async function collectGovuk (get: Get, keep: Keep, readOn: string): Promise<Omit<Collection, 'requests'>> {
  const results: SearchResult[] = []
  for (let start = 0; ; start += PAGE_SIZE) {
    const text = await getText(get, searchUrl(start))
    keep(`search-${start}.json`, text)
    const page = JSON.parse(text) as { results: SearchResult[], total: number }
    results.push(...page.results)
    if (page.results.length === 0 || start + PAGE_SIZE >= page.total) break
  }

  const entries: Entry[] = []
  const problems: string[] = []
  for (const result of results) {
    try {
      const text = await getText(get, `${CONTENT}${result.link}`)
      keep(`content${result.link.replaceAll('/', '-')}.json`, text)
      entries.push(govukEntry(result, JSON.parse(text) as ContentItem, text))
    } catch (error) {
      problems.push(`${result.link}: ${(error as Error).message}`)
      entries.push(govukEntry(result, null, null))
    }
  }

  return { source: 'govuk-finder', label: 'GOV.UK business finance support finder', readOn, entries, problems }
}
