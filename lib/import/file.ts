import type { Result } from "@/lib/services/result"

import { parseCsv, unescapeCell } from "./csv"

// Reading an uploaded import file: the limits, the header and the rows.

export const IMPORT_LIMITS = { maxBytes: 256 * 1024, maxRows: 1000 } as const

// One column the import reads. The header is what the template writes;
// aliases are other headers taken for the same column.
export type ImportColumn<K extends string> = { key: K; header: string; aliases?: readonly string[] }

// A data row: its row number in the sheet (the header is row 1) and its
// cells by column, exactly as the file holds them.
export type ImportRecord<K extends string> = { sheetRow: number; cells: Record<K, string> }

export type ImportFileError =
  | { kind: "too-large"; maxBytes: number }
  | { kind: "too-many-rows"; maxRows: number; rows: number }
  | { kind: "not-utf8" }
  // No header, or a header and no rows.
  | { kind: "empty" }
  | { kind: "missing-columns"; columns: readonly string[] }
  // A quote left open.
  | { kind: "unreadable" }

const headerKey = (header: string) => header.trim().toLowerCase().replace(/[\s_]+/g, " ")

export function readImportFile<K extends string>(
  bytes: Uint8Array,
  columns: readonly ImportColumn<K>[],
  limits: { maxBytes: number; maxRows: number } = IMPORT_LIMITS,
): Result<{ rows: ImportRecord<K>[] }, ImportFileError> {
  if (bytes.byteLength > limits.maxBytes) return { ok: false, error: { kind: "too-large", maxBytes: limits.maxBytes } }

  let text: string
  try {
    // Drops a byte-order mark itself.
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)
  } catch {
    return { ok: false, error: { kind: "not-utf8" } }
  }

  const records = parseCsv(text)
  if (records === null) return { ok: false, error: { kind: "unreadable" } }
  const [header, ...body] = records
  if (!header || header.every((cell) => cell.trim() === "")) return { ok: false, error: { kind: "empty" } }

  const headers = header.map(headerKey)
  const positions = new Map<K, number>()
  const missing: string[] = []
  for (const column of columns) {
    const names = [column.header, ...(column.aliases ?? [])].map(headerKey)
    const position = headers.findIndex((h) => names.includes(h))
    if (position === -1) missing.push(column.header)
    else positions.set(column.key, position)
  }
  if (missing.length > 0) return { ok: false, error: { kind: "missing-columns", columns: missing } }

  const rows: ImportRecord<K>[] = []
  body.forEach((record, index) => {
    if (record.every((cell) => cell.trim() === "")) return
    const cells = {} as Record<K, string>
    for (const column of columns) cells[column.key] = unescapeCell(record[positions.get(column.key)!] ?? "")
    rows.push({ sheetRow: index + 2, cells })
  })
  if (rows.length === 0) return { ok: false, error: { kind: "empty" } }
  if (rows.length > limits.maxRows) return { ok: false, error: { kind: "too-many-rows", maxRows: limits.maxRows, rows: rows.length } }
  return { ok: true, data: { rows } }
}
