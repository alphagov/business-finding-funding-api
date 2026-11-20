import { fingerprint, getText, type Get } from '../http'
import { fieldName, first, listOf, textOf, withoutEmails } from '../text'
import type { Collection, Entry, Value } from '../entry'

// The North East Growth Hub, run by the North East Mayoral Strategic
// Authority for the seven council areas north of the Tees. It has no API and
// its sitemap leaves out the scheme pages, so the spike reads its pages:
//
// - the resource list, every page of it, for each entry's name, type and
//   summary
// - the business support list, for the tags on its cards (areas, business
//   stage, and grant, loan or equity)
// - the own page of each entry that is about finance, for its labelled
//   fields
//
// Scheme pages name a contact person with their email address. The spike
// does not keep them: those fields are skipped, and the pages are not saved.

const BASE = 'https://growthhub.northeast-ca.gov.uk'
const FINANCE = /finance|grant|loan|equity/i

export interface Card {
  slug: string
  name: string
  summary: string
  // The card's labels, such as "Finance & funding" or "County Durham".
  labels: string[]
}

export interface SchemePage {
  name: string | null
  summary: string | null
  provider: string | null
  providerPage: string | null
  status: string | null
  updated: string | null
  isScheme: boolean
  fields: Record<string, Value>
  text: string
}

// Cards on a list page. The two lists mark up their cards slightly
// differently, so each card is read from its own block of markup.
export function cardsOf (html: string, itemClass: string): Card[] {
  const blocks = html.split(itemClass).slice(1)
  const cards: Card[] = []
  for (const block of blocks) {
    const slug = /href="\/resource\/([^"#?/]+)"/.exec(block)?.[1]
    if (slug === undefined) continue
    const labels = [...block.matchAll(/<span class="chip[^"]*"[^>]*>([\s\S]*?)<\/span>/g)]
      .flatMap((match) => textOf(match[1]).split(' / '))
      .map((one) => one.trim())
      .filter((one) => one !== '')
    cards.push({
      slug,
      name: first(block, /<h3[^>]*>([\s\S]*?)<\/h3>/) ?? slug,
      summary: first(block, /<div class="foundation-promo-panel__text">([\s\S]*?)<\/div>/) ?? '',
      labels
    })
  }
  return cards
}

export function lastPage (html: string): number {
  const pages = [...html.matchAll(/href="\/resource\?page=(\d+)"/g)].map((match) => Number(match[1]))
  return Math.max(1, ...pages)
}

export function schemePage (html: string): SchemePage {
  const fields: Record<string, Value> = {}

  for (const item of html.matchAll(/<p class="resource-view__detail-item">([\s\S]*?)<\/p>/g)) {
    const label = first(item[1], /<strong[^>]*>([\s\S]*?)<\/strong>/)?.replace(/:$/, '')
    const value = first(item[1], /<span class="resource-view__detail-item-value">([\s\S]*)<\/span>/)
    // Key contact, Contact email and Telephone are a person's contact details.
    if (label == null || value === null || /contact|email|phone/i.test(label)) continue
    fields[fieldName(label)] = ['Area', 'Categories'].includes(label) ? listOf(value) : value
  }

  const keyInfo = /<div class="key-info-panel[\s\S]*?<\/h2>([\s\S]*?)<\/div>/.exec(html)?.[1] ?? ''
  for (const item of keyInfo.matchAll(/<p>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/p>/g)) {
    fields[fieldName(textOf(item[1]))] = textOf(item[2]).replace(/^:\s*/, '')
  }

  const provided = /Provided by:\s*(?:<a href="([^"]*)"[^>]*>([\s\S]*?)<\/a>|([^<]+))/.exec(html)
  const content = html.indexOf('resource-view__content-container')
  const end = html.indexOf('<footer', content)

  return {
    name: first(html, /<h1[^>]*resource-view__name[^>]*>([\s\S]*?)<\/h1>/),
    summary: first(html, /<div class="collection-entry__summary">([\s\S]*?)<\/div>/),
    provider: provided === null ? null : textOf(provided[2] ?? provided[3] ?? ''),
    providerPage: provided?.[1] ?? null,
    status: first(html, /class="[^"]*resource-view__open-status-chip"[^>]*>([\s\S]*?)<\/a>/),
    updated: first(html, /Page last updated:\s*([^<]+)/),
    isScheme: html.includes('Scheme details'),
    fields,
    text: content < 0 ? '' : withoutEmails(textOf(html.slice(content, end < 0 ? undefined : end))).slice(0, 8000)
  }
}

export function growthHubEntry (card: Card, tags: string[], page: SchemePage | null, pageText: string | null): Entry {
  return {
    source: 'north-east-growth-hub',
    id: card.slug,
    name: page?.name ?? card.name,
    page: `${BASE}/resource/${card.slug}`,
    read: page === null ? 'listing only' : 'page',
    provider: page?.provider ?? null,
    providerPage: page?.providerPage ?? null,
    applyPage: null,
    updated: page?.updated ?? null,
    fields: {
      summary: page?.summary ?? (card.summary === '' ? null : card.summary),
      list_labels: card.labels,
      business_support_tags: tags,
      is_scheme: page?.isScheme ?? null,
      status: page?.status ?? null,
      ...page?.fields
    },
    text: page?.text ?? withoutEmails(card.summary),
    fingerprint: pageText === null ? null : fingerprint(pageText)
  }
}

export async function collectGrowthHub (get: Get, readOn: string): Promise<Omit<Collection, 'requests'>> {
  // Every page of the resource list is read. Its later pages (from page 13
  // or 14 of 21 on 20 November 2026, as the order changes) are careers and
  // schools resources with no page of their own, which are passed over.
  const cards = new Map<string, Card>()
  for (let page = 1, last = 1; page <= last; page += 1) {
    const html = await getText(get, `${BASE}/resource?page=${page}`)
    for (const card of cardsOf(html, 'resource-list__item')) cards.set(card.slug, card)
    last = Math.max(last, lastPage(html))
  }

  // The business support list tags its cards with areas, stage and kind of
  // help. Entries on it that are not on the resource list are added.
  const tags = new Map<string, string[]>()
  for (const card of cardsOf(await getText(get, `${BASE}/business-support`), 'resource-list-component__item')) {
    tags.set(card.slug, card.labels)
    if (!cards.has(card.slug)) cards.set(card.slug, { ...card, labels: [] })
  }

  const entries: Entry[] = []
  const problems: string[] = []
  for (const card of cards.values()) {
    const cardTags = tags.get(card.slug) ?? []
    if (![...card.labels, ...cardTags].some((label) => FINANCE.test(label))) {
      entries.push(growthHubEntry(card, cardTags, null, null))
      continue
    }
    try {
      const html = await getText(get, `${BASE}/resource/${card.slug}`)
      const page = schemePage(html)
      if (page.name === null) {
        // A removed entry's address shows the resource list instead.
        problems.push(html.includes('resource-list__item')
          ? `${card.slug}: the page shows the resource list instead, so the entry seems to have been removed.`
          : `${card.slug}: the page has no name. It may have changed shape.`)
        entries.push(growthHubEntry(card, cardTags, null, null))
        continue
      }
      entries.push(growthHubEntry(card, cardTags, page, html))
    } catch (error) {
      problems.push(`${card.slug}: ${(error as Error).message}`)
      entries.push(growthHubEntry(card, cardTags, null, null))
    }
  }

  return { source: 'north-east-growth-hub', label: 'North East Growth Hub', readOn, entries, problems }
}
