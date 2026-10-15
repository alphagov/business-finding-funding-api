import fs from 'node:fs'
import path from 'node:path'
import { readWorkbook, type Cell, type Workbook } from './workbook'

// Copies the schemes from TPX's One Platform schema workbook into
// data/one-platform-schemes.json, which each deploy imports. Only the rows
// of the Loans, Grants and Equities sheets are copied, so the comments, the
// names of the people who made them, links to internal documents and the
// document's properties are left out of this public repository.
//
//   npm run tpx:extract -- "path/to/One platform schema v1.3.xlsx"
//
// verified_by is also left out. It will hold the names of the people who
// checked each scheme, which stay in the workbook.
//
// The rows are copied as they are, without being checked or mapped, so the
// file is the workbook's data and a pull request shows exactly what changed
// between versions. The import checks and maps them.

export const EXTRACT_FILE = path.join(__dirname, '..', '..', 'data', 'one-platform-schemes.json')

const LEFT_OUT = new Set(['verified_by'])

export interface Extract extends Workbook {
  // The workbook the rows were copied from.
  source: string
}

// Dates are written as YYYY-MM-DD, as the import reads them.
function value (cell: Cell): Cell {
  return cell instanceof Date ? cell.toISOString().slice(0, 10) : cell
}

export function extract (workbook: Workbook, source: string): Extract {
  return {
    source,
    columns: Object.fromEntries(Object.entries(workbook.columns).map(([sheet, columns]) => [sheet, columns.filter((column) => !LEFT_OUT.has(column))])),
    rows: workbook.rows.map(({ sheet, row, values }) => ({
      sheet,
      row,
      values: Object.fromEntries(Object.entries(values).filter(([column]) => !LEFT_OUT.has(column)).map(([column, cell]) => [column, value(cell)]))
    }))
  }
}

export function readExtract (file = EXTRACT_FILE): Extract {
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Extract
}

if (require.main === module) {
  const file = process.argv[2]

  if (!file) {
    console.error('Give the path to the workbook, for example: npm run tpx:extract -- "One platform schema v1.3.xlsx"')
    process.exit(1)
  }

  readWorkbook(file)
    .then((workbook) => {
      const data = extract(workbook, path.basename(file))
      fs.writeFileSync(EXTRACT_FILE, `${JSON.stringify(data, null, 2)}\n`)
      console.log(`Copied ${data.rows.length} rows from ${data.source} to ${path.relative(process.cwd(), EXTRACT_FILE)}`)
    })
    .catch((err) => {
      console.error(err.message)
      process.exitCode = 1
    })
}
