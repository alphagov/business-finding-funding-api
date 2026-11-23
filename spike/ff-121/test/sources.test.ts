import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getText, politeReader, USER_AGENT, type Reply } from '../http'
import { decode, listOf, textOf, withoutEmails } from '../text'
import { govukEntry, searchUrl } from '../sources/govuk'
import { grantEntry, listingUrl, pageData, richText, type GrantDetail } from '../sources/findAGrant'
import { cardsOf, growthHubEntry, lastPage, schemePage } from '../sources/growthHub'
import { entryAddresses, teesValleyEntry } from '../sources/teesValley'

// The markup and data below are made up, in the shape each source used on
// 20 November 2026. None of it is copied from a real page.

test('text: decodes entities, keeps line breaks and removes email addresses', () => {
  assert.equal(decode('Finance&nbsp;&amp;&nbsp;funding &#8217;s &#x2013; &bogus;'), 'Finance & funding ’s – &bogus;')
  assert.equal(textOf('<p>One <b>two</b></p><ul><li>Three</li></ul><script>x()</script>'), 'One two\nThree')
  assert.equal(withoutEmails('Ask a.person@example.gov.uk today'), 'Ask [email address removed] today')
  assert.deepEqual(listOf('Retail , Tourism & Leisure,'), ['Retail', 'Tourism & Leisure'])
})

test('requests: one at a time, spaced apart, with the spike User-Agent', async () => {
  const seen: Array<{ at: number, agent: string | null }> = []
  const fake = (async (_url: string | URL | Request, init?: RequestInit) => {
    seen.push({ at: Date.now(), agent: new Headers(init?.headers).get('user-agent') })
    return new Response('ok')
  }) as typeof fetch
  const reader = politeReader(40, fake)

  await Promise.all([reader.get('https://a.example/1'), reader.get('https://a.example/2'), reader.get('https://a.example/3')])

  assert.equal(reader.requests(), 3)
  assert.ok(seen.every((one) => one.agent === USER_AGENT))
  assert.ok(seen[1].at - seen[0].at >= 35 && seen[2].at - seen[1].at >= 35)
})

test('requests: a server error is tried once more, a missing page is not', async () => {
  const replies = (statuses: number[]) => {
    const asked: string[] = []
    const get = async (url: string): Promise<Reply> => {
      asked.push(url)
      const status = statuses.shift() ?? 200
      return { url, status, text: `status ${status}` }
    }
    return { get, asked }
  }

  const flaky = replies([500, 200])
  assert.equal(await getText(flaky.get, 'https://a.example/', 1), 'status 200')
  assert.equal(flaky.asked.length, 2)

  const broken = replies([500, 500])
  await assert.rejects(getText(broken.get, 'https://a.example/', 1), /gave 500/)

  const missing = replies([404])
  await assert.rejects(getText(missing.get, 'https://a.example/', 1), /gave 404/)
  assert.equal(missing.asked.length, 1)
})

test('GOV.UK: an entry takes the coded values and the running body link', () => {
  assert.match(searchUrl(100), /filter_regions=north-east.*start=100/)

  const entry = govukEntry(
    {
      title: 'Made-up Grant',
      link: '/business-finance-support/made-up-grant',
      regions: ['north-east'],
      types_of_support: ['grant'],
      business_stages: ['start-up'],
      organisations: [{ title: 'Department for Made-up Things' }],
      public_timestamp: '2026-01-02T10:00:00Z'
    },
    {
      public_updated_at: '2026-03-04T10:00:00Z',
      details: {
        body: '<p>Grants for shops. Email help@example.org.</p>',
        metadata: { continuation_link: 'https://www.example.org/grant', will_continue_on: 'the example website' }
      }
    },
    '{}'
  )

  assert.equal(entry.page, 'https://www.gov.uk/business-finance-support/made-up-grant')
  assert.equal(entry.read, 'page')
  assert.equal(entry.provider, null)
  assert.equal(entry.providerPage, 'https://www.example.org/grant')
  assert.equal(entry.updated, '2026-03-04T10:00:00Z')
  assert.deepEqual(entry.fields.publisher, ['Department for Made-up Things'])
  assert.deepEqual(entry.fields.types_of_support, ['grant'])
  assert.equal(entry.text, 'Grants for shops. Email [email address removed].')
})

test('Find a Grant: reads the page data and keeps the listing dates apart', () => {
  assert.match(listingUrl(2), /grantLocation\.en-US=4.*skip=10.*page=2/)

  const html = '<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"totalGrants":1}}}</script></html>'
  assert.deepEqual(pageData(html), { totalGrants: 1 })
  assert.throws(() => pageData('<html></html>'), /changed shape/)

  const detail: GrantDetail = {
    sys: { updatedAt: '2026-11-17T10:00:00Z' },
    fields: {
      label: 'made-up-fund-1',
      grantName: 'Made-up Fund',
      grantFunder: 'Made-up Office',
      grantMaximumAward: 50000,
      grantApplicationOpenDate: '2026-11-02T00:00+00:00',
      grantWebpageUrl: 'https://apply.example.org/start',
      grantEligibilityTab: { nodeType: 'document', content: [{ nodeType: 'paragraph', content: [{ value: 'Charities only. Contact grants@example.org.' }] }] }
    }
  }
  const entry = grantEntry({ label: 'made-up-fund-1', grantName: 'Made-up Fund', grantApplicationOpenDate: '1016-11-02T00:00' }, detail, html)

  assert.equal(entry.fields.opening_date, '2026-11-02T00:00+00:00')
  assert.equal(entry.fields.listing_opening_date, '1016-11-02T00:00')
  assert.equal(entry.applyPage, 'https://apply.example.org/start')
  assert.equal(entry.text, 'Eligibility\nCharities only. Contact [email address removed].')
  assert.equal(richText(undefined), '')
})

const RESOURCE_LIST = `
  <a href="/resource?page=2">2</a><a href="/resource?page=21">21</a>
  <div class="o-layout__item resource-list__item foundation-promo-panel-list__item">
    <span class="chip u-gradient"> Finance&nbsp;&&nbsp;funding / Business&nbsp;support</span>
    <h3 class="heading foundation-promo-panel__title">Made-up Growth Grant</h3>
    <div class="foundation-promo-panel__text">Grants for growing firms.</div>
    <a class="button" href="/resource/made-up-growth-grant" > More </a>
  </div>
  <div class="o-layout__item resource-list__item foundation-promo-panel-list__item">
    <span class="chip u-gradient"> Business&nbsp;support</span>
    <h3 class="heading foundation-promo-panel__title">Made-up Mentoring</h3>
    <a class="button" href="/resource/made-up-mentoring" > More </a>
  </div>`

const SCHEME_PAGE = `
  <h1 class="heading heading--1 collection-entry__name resource-view__name">Made-up Growth Grant</h1>
  <div class="collection-entry__summary"><p>Grants for growing firms</p></div>
  <p> Provided by: <a href="https://www.example.org/"> Made-up Council </a> </p>
  <div class="resource-view__open-status-chip-container"><a class="button collection-entry__open-status-chip resource-view__open-status-chip" style="x" href="#r">Open</a></div>
  <h3>Scheme details</h3>
  <p class="resource-view__detail-item"><strong class="resource-view__detail-item-title">Area:</strong> <span class="resource-view__detail-item-value"> Gateshead, Sunderland </span></p>
  <p class="resource-view__detail-item"><strong class="resource-view__detail-item-title">Categories:</strong> <span class="resource-view__detail-item-value"> Finance &amp; funding, Grant </span></p>
  <p class="resource-view__detail-item"><strong class="resource-view__detail-item-title">Key contact:</strong> <span class="resource-view__detail-item-value"> A Person, Officer </span></p>
  <p class="resource-view__detail-item"><strong class="resource-view__detail-item-title">Contact email:</strong> <span class="resource-view__detail-item-value"><span class="email"><a href="mailto:a.person@example.org">a.person@example.org</a></span></span></p>
  <p class="resource-view__detail-item"><strong class="resource-view__detail-item-title">Telephone:</strong> <span class="resource-view__detail-item-value"> 01234 567890 </span></p>
  <p class="collection-entry__published-date"> Page last updated: 21 March 2025</p>
  <div class="key-info-panel well"><h2> Key information </h2><p><strong>Grant Size</strong>: £5,000 – £35,000</p> <p><strong>Deadline</strong>: Rolling</p> </div>
  <div class="resource-view__content-container"><p>Apply by email to a.person@example.org.</p></div>
  <footer>Footer</footer>`

test('Growth Hub: list cards, last page and labelled fields, without contact details', () => {
  const cards = cardsOf(RESOURCE_LIST, 'resource-list__item')
  assert.deepEqual(cards.map((card) => [card.slug, card.labels]), [
    ['made-up-growth-grant', ['Finance & funding', 'Business support']],
    ['made-up-mentoring', ['Business support']]
  ])
  assert.equal(cards[0].name, 'Made-up Growth Grant')
  assert.equal(lastPage(RESOURCE_LIST), 21)

  const page = schemePage(SCHEME_PAGE)
  assert.equal(page.name, 'Made-up Growth Grant')
  assert.equal(page.provider, 'Made-up Council')
  assert.equal(page.providerPage, 'https://www.example.org/')
  assert.equal(page.status, 'Open')
  assert.equal(page.updated, '21 March 2025')
  assert.equal(page.isScheme, true)
  assert.equal(page.text, 'Apply by email to [email address removed].', 'the text has none of the tag\'s markup')
  assert.deepEqual(page.fields, { area: ['Gateshead', 'Sunderland'], categories: ['Finance & funding', 'Grant'], grant_size: '£5,000 – £35,000', deadline: 'Rolling' })

  const entry = growthHubEntry(cards[0], ['Grant'], page, SCHEME_PAGE)
  const saved = JSON.stringify(entry)
  assert.ok(!saved.includes('A Person') && !saved.includes('a.person@') && !saved.includes('01234'), 'no contact details are kept')
  assert.equal(entry.read, 'page')
  assert.deepEqual(entry.fields.business_support_tags, ['Grant'])

  const listed = growthHubEntry(cards[1], [], null, null)
  assert.equal(listed.read, 'listing only')
  assert.equal(listed.fingerprint, null)
})

test('Tees Valley: entries from the sitemap and their support details, without contact details', () => {
  const sitemap = `<urlset>
    <url><loc>https://teesvalley-ca.gov.uk/business/business-support/</loc></url>
    <url><loc>https://teesvalley-ca.gov.uk/business/business-support/made-up-fund/</loc></url>
  </urlset>`
  assert.deepEqual(entryAddresses(sitemap), ['https://teesvalley-ca.gov.uk/business/business-support/made-up-fund/'])

  const html = `
    <meta property="article:modified_time" content="2026-06-10T13:14:47+00:00" />
    <h1>Made-up Fund</h1>
    <div class="business-support-details"> <h2>Support Details</h2> <ul>
      <li><strong>Location:</strong> Darlington, Hartlepool</li>
      <li><strong>Business Stage:</strong> Start-Up</li>
      <li><strong>Sector:</strong> Retail , Tourism &amp; Leisure</li>
      <li><strong>Help Categories:</strong> Accessing Finance &amp; Funding</li>
    </ul> </div>
    <div class="intro-content"><p>Loans from £1,000.</p></div>
    <div class="business-support-sidebar"><h3>Contact Details</h3><ul><li><strong>Telephone: 01234 567890</strong></li></ul>
    <a href="https://www.example.org/fund/" class="button" target="_blank">Visit Website</a>
    <a href="https://www.example.org/apply/" class="button">Apply here <i>→</i></a></div>`
  const entry = teesValleyEntry('https://teesvalley-ca.gov.uk/business/business-support/made-up-fund/', html)

  assert.equal(entry.id, 'made-up-fund')
  assert.equal(entry.name, 'Made-up Fund')
  assert.deepEqual(entry.fields, {
    location: ['Darlington', 'Hartlepool'],
    business_stage: ['Start-Up'],
    sector: ['Retail', 'Tourism & Leisure'],
    help_categories: ['Accessing Finance & Funding']
  })
  assert.equal(entry.text, 'Loans from £1,000.')
  assert.equal(entry.providerPage, 'https://www.example.org/fund/')
  assert.equal(entry.applyPage, 'https://www.example.org/apply/')
  assert.equal(entry.updated, '2026-06-10T13:14:47+00:00')
  assert.ok(!JSON.stringify(entry).includes('01234'), 'no contact details are kept')
})
