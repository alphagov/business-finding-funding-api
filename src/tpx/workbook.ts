import readXlsxFile from 'read-excel-file/node'

// Reads the schemes from TPX's One Platform schema workbook: one sheet each
// for loans, grants and equity, with the column headings in the first row.

export type Cell = string | number | boolean | Date | null

export interface WorkbookRow {
  sheet: string
  // The row number in the sheet, counting the headings as row 1.
  row: number
  values: Record<string, Cell>
}

export interface Workbook {
  rows: WorkbookRow[]
  // Columns that are read, by sheet, so columns that are not can be reported.
  columns: Record<string, string[]>
}

export const SHEETS: Record<string, string> = {
  Loans: 'loan',
  Grants: 'grant',
  Equities: 'equity'
}

// Headings are matched in lower case, without the spaces and non-breaking
// spaces some of them end with.
function heading (value: unknown): string {
  return String(value ?? '').replace(/[\s ]+/g, ' ').trim().toLowerCase()
}

export async function readWorkbook (file: string | Buffer): Promise<Workbook> {
  const sheets = await readXlsxFile(file)
  const rows: WorkbookRow[] = []
  const columns: Record<string, string[]> = {}

  for (const name of Object.keys(SHEETS)) {
    const sheet = sheets.find((candidate) => candidate.sheet === name)
    if (!sheet) throw new Error(`The workbook has no ${name} sheet`)

    const [headings = [], ...data] = sheet.data as Cell[][]
    const names = headings.map(heading)
    columns[name] = names.filter(Boolean)

    data.forEach((cells, index) => {
      if (cells.every((cell) => cell === null || cell === '')) return
      const values: Record<string, Cell> = {}
      names.forEach((column, position) => {
        if (column) values[column] = cells[position] ?? null
      })
      rows.push({ sheet: name, row: index + 2, values })
    })
  }

  return { rows, columns }
}
