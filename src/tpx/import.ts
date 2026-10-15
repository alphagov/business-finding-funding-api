import path from 'node:path'
import type pg from 'pg'
import { loadConfig } from '../config'
import { createPool } from '../db'
import { saveSchemes } from '../records'
import { convertWorkbook, type Conversion, type Lists } from './convert'
import { readWorkbook } from './workbook'

// Imports the schemes from TPX's One Platform schema workbook into the
// database, replacing the schemes there. Schemes with problems are not
// imported, and the problems are listed so they can be fixed in the
// workbook.
//
//   npm run tpx:import -- "path/to/One platform schema v1.3.xlsx"
//
// Add --check to list the problems without changing the database.
//
// For now this is only run locally. Each deploy loads data/funding-schemes.json
// on Heroku, which would replace the imported schemes.

export async function readLists (pool: pg.Pool): Promise<Lists> {
  const codes = async (table: string): Promise<Set<string>> =>
    new Set((await pool.query<{ code: string }>(`select code from ${table}`)).rows.map((row) => row.code))
  const sectors = await pool.query<{ code: string, name: string }>('select code, name from sectors')

  return {
    statuses: await codes('scheme_statuses'),
    sourceTypes: await codes('source_types'),
    spendTypes: await codes('spend_types'),
    purposes: await codes('purposes'),
    businessStages: await codes('business_stages'),
    legalStructures: await codes('legal_structures'),
    sectors: new Map(sectors.rows.map((row) => [row.name.toLowerCase(), row.code])),
    areas: await codes('areas')
  }
}

// The problems, as text that can be sent to whoever looks after the
// workbook.
export function report (file: string, { records, rejected, ignoredColumns }: Conversion): string {
  const lines = [
    `${path.basename(file)}: ${records.length + rejected.length} rows, ${records.length} can be imported, ${rejected.length} cannot.`
  ]

  for (const { id, sheet, row, problems } of rejected) {
    lines.push('', `${id} (${sheet} sheet, row ${row})`, ...problems.map((problem) => `- ${problem}`))
  }
  if (ignoredColumns.length) lines.push('', `Columns that are not imported: ${ignoredColumns.join(', ')}`)

  return lines.join('\n')
}

export async function importWorkbook (pool: pg.Pool, file: string, { check = false } = {}): Promise<{ conversion: Conversion, removed: string[] }> {
  const conversion = convertWorkbook(await readWorkbook(file), await readLists(pool))
  if (check) return { conversion, removed: [] }

  const { removed } = await saveSchemes(pool, conversion.records)
  return { conversion, removed }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const check = args.includes('--check')
  const file = args.find((arg) => !arg.startsWith('--'))

  if (!file) {
    console.error('Give the path to the workbook, for example: npm run tpx:import -- "One platform schema v1.3.xlsx"')
    process.exit(1)
  }

  const pool = createPool(loadConfig())

  importWorkbook(pool, file, { check })
    .then(({ conversion, removed }) => {
      console.log(report(file, conversion))
      console.log('')
      if (check) console.log('Checked only. The database has not changed.')
      else console.log(`Imported ${conversion.records.length} schemes${removed.length ? `, and removed ${removed.length} that are not in the workbook` : ''}.`)
    })
    .catch((err) => {
      console.error(err.message)
      process.exitCode = 1
    })
    .finally(() => pool.end())
}
