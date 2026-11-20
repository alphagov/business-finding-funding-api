import { fingerprint, getText, type Get } from '../http'
import { fieldName, first, listOf, textOf, withoutEmails } from '../text'
import type { Collection, Entry, Value } from '../entry'

// The Tees Valley Combined Authority's business support directory, for the
// five Tees Valley council areas. It is a WordPress site whose API does not
// publish the directory, so the spike takes the entries from the site's
// sitemap and reads each entry's labelled "Support Details". Contact details
// are not read.

const BASE = 'https://teesvalley-ca.gov.uk/business'
const SITEMAP = `${BASE}/business-support-sitemap.xml`
const LISTS = new Set(['location', 'business_stage', 'sector', 'help_categories'])

export function entryAddresses (sitemap: string): string[] {
  return [...sitemap.matchAll(/<loc>\s*([^<]+?)\s*<\/loc>/g)]
    .map((match) => match[1])
    .filter((address) => /\/business-support\/[^/]+\/?$/.test(address))
}

export function teesValleyEntry (address: string, html: string): Entry {
  const fields: Record<string, Value> = {}
  const details = /<div class="business-support-details">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? ''
  for (const item of details.matchAll(/<li>\s*<strong>([\s\S]*?)<\/strong>([\s\S]*?)<\/li>/g)) {
    const name = fieldName(textOf(item[1]))
    const value = textOf(item[2])
    fields[name] = LISTS.has(name) ? listOf(value) : value
  }

  // The description runs from the intro to the tag that opens the sidebar.
  const intro = html.indexOf('class="intro-content"')
  const sidebarClass = html.indexOf('business-support-sidebar', intro)
  const sidebar = sidebarClass < 0 ? -1 : html.lastIndexOf('<', sidebarClass)
  const slug = /\/business-support\/([^/]+)\/?$/.exec(address)?.[1] ?? address

  return {
    source: 'tees-valley',
    id: slug,
    name: first(html, /<h1[^>]*>([\s\S]*?)<\/h1>/) ?? slug,
    page: address,
    read: 'page',
    provider: null,
    providerPage: /<a href="([^"]+)"[^>]*>\s*Visit Website/.exec(html)?.[1] ?? null,
    applyPage: /<a href="([^"]+)"[^>]*>\s*Apply here/.exec(html)?.[1] ?? null,
    updated: /<meta property="article:modified_time" content="([^"]+)"/.exec(html)?.[1] ?? null,
    fields,
    text: intro < 0 ? '' : withoutEmails(textOf(`<div ${html.slice(intro, sidebar < 0 ? undefined : sidebar)}`)).slice(0, 8000),
    fingerprint: fingerprint(html)
  }
}

export async function collectTeesValley (get: Get, readOn: string): Promise<Omit<Collection, 'requests'>> {
  const addresses = entryAddresses(await getText(get, SITEMAP))
  const entries: Entry[] = []
  const problems: string[] = []
  for (const address of addresses) {
    try {
      const entry = teesValleyEntry(address, await getText(get, address))
      if (Object.keys(entry.fields).length === 0) problems.push(`${address}: the page has no support details. It may have changed shape.`)
      entries.push(entry)
    } catch (error) {
      problems.push(`${address}: ${(error as Error).message}`)
    }
  }
  return { source: 'tees-valley', label: 'Tees Valley Combined Authority business support directory', readOn, entries, problems }
}
