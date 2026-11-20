import fs from 'node:fs'
import path from 'node:path'
import { politeReader, type Get } from './http'
import { withoutEmails } from './text'
import type { Collection, Keep, SourceName } from './entry'
import { collectGovuk } from './sources/govuk'
import { collectFindAGrant } from './sources/findAGrant'
import { collectGrowthHub } from './sources/growthHub'
import { collectTeesValley } from './sources/teesValley'

// Day 1 of the FF-121 spike: reads the four sources and saves every North
// East entry as each source gives it, before any mapping.
//
//   npm run spike:collect
//   npm run spike:collect -- --only govuk-finder,tees-valley
//
// The files go to spike/ff-121/output/<date>/, which git ignores. This
// repository is public, and the files are working copies for the spike, not
// data to publish. A full run makes about 300 requests at one a second, so
// it takes about 5 minutes.

type Collector = (get: Get, keep: Keep, readOn: string) => Promise<Omit<Collection, 'requests'>>

const COLLECTORS: Record<SourceName, Collector> = {
  'govuk-finder': collectGovuk,
  'find-a-grant': collectFindAGrant,
  'north-east-growth-hub': async (get, _keep, readOn) => await collectGrowthHub(get, readOn),
  'tees-valley': async (get, _keep, readOn) => await collectTeesValley(get, readOn)
}

export const OUTPUT = path.join(__dirname, 'output')

function chosen (args: string[]): SourceName[] {
  const at = args.indexOf('--only')
  if (at < 0) return Object.keys(COLLECTORS) as SourceName[]
  const names = (args[at + 1] ?? '').split(',').filter((name) => name !== '')
  const unknown = names.filter((name) => !(name in COLLECTORS))
  if (names.length === 0 || unknown.length > 0) {
    throw new Error(`Name the sources to read after --only, from: ${Object.keys(COLLECTORS).join(', ')}`)
  }
  return names as SourceName[]
}

async function main (): Promise<void> {
  const sources = chosen(process.argv.slice(2))
  const readOn = new Date().toISOString().slice(0, 10)
  const folder = path.join(OUTPUT, readOn)
  const reader = politeReader()

  for (const source of sources) {
    const raw = path.join(folder, 'raw', source)
    const keep: Keep = (name, text) => {
      fs.mkdirSync(raw, { recursive: true })
      fs.writeFileSync(path.join(raw, name), withoutEmails(text))
    }

    const before = reader.requests()
    const collected = await COLLECTORS[source](reader.get, keep, readOn)
    const collection: Collection = { ...collected, requests: reader.requests() - before }

    fs.mkdirSync(folder, { recursive: true })
    fs.writeFileSync(path.join(folder, `${source}.json`), `${JSON.stringify(collection, null, 2)}\n`)

    const read = collection.entries.filter((entry) => entry.read === 'page').length
    console.log(`${collection.label}: ${collection.entries.length} entries, ${read} read from their own page, ${collection.requests} requests, ${collection.problems.length} problems`)
    for (const problem of collection.problems) console.log(`  ${problem}`)
  }

  console.log(`Saved in ${path.relative(process.cwd(), folder)}`)
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error((error as Error).message)
    process.exit(1)
  })
}
