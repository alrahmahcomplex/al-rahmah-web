// The import module: reading an uploaded CSV within the limits, matching its
// columns, finding rows that repeat a value, and writing the refused rows
// back out as CSV. It knows nothing of any table, so the agent import and
// the student import share it. Each import adds its own columns,
// normalisation and checks on top.

import { toCsv } from "./csv"

export { parseCsv, toCsv } from "./csv"
export { IMPORT_LIMITS, readImportFile, type ImportColumn, type ImportFileError, type ImportRecord } from "./file"
export { importFileMessage, type Bilingual } from "./messages"

// For each row whose key another row repeats: every row holding that key, in
// sheet order. Rows with no key never match.
export function findDuplicates(rows: readonly { sheetRow: number; key: string | null }[]): Map<number, number[]> {
  const byKey = new Map<string, number[]>()
  for (const row of rows) {
    if (row.key === null) continue
    const list = byKey.get(row.key)
    if (list) list.push(row.sheetRow)
    else byKey.set(row.key, [row.sheetRow])
  }
  const duplicates = new Map<number, number[]>()
  for (const list of byKey.values()) {
    if (list.length < 2) continue
    for (const sheetRow of list) duplicates.set(sheetRow, list)
  }
  return new Map([...duplicates.entries()].sort(([a], [b]) => a - b))
}

// The refused-rows file: the columns as the template names them, then each
// row's reason and its row in the uploaded sheet. The import reads the
// extra columns back as nothing, so the file can be fixed and uploaded again.
export function refusedRowsCsv<K extends string>(
  columns: readonly { key: K; header: string }[],
  rows: readonly { sheetRow: number; cells: Record<K, string>; reason: string }[],
): string {
  return toCsv([
    [...columns.map((column) => column.header), "Reason", "Sheet row"],
    ...rows.map((row) => [...columns.map((column) => row.cells[column.key]), row.reason, String(row.sheetRow)]),
  ])
}
