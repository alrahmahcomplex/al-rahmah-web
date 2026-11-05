// CSV reading and writing for imports (RFC 4180): commas, double quotes,
// quoted line breaks, CRLF or LF. Runs the same in the browser and on the
// server.

// Characters a spreadsheet reads as the start of a formula. A cell written
// back out that starts with one gets a leading apostrophe, so opening the
// refused-rows file in Excel or Google Sheets never runs it.
const FORMULA_START = /^[=+\-@\t\r]/

// Records, each an array of cells, or null when a quote is left open.
export function parseCsv(text: string): string[][] | null {
  const records: string[][] = []
  let record: string[] = []
  let cell = ""
  let quoted = false
  let i = 0
  while (i < text.length) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i += 1
        continue
      }
      cell += char
      i += 1
      continue
    }
    if (char === '"' && cell === "") {
      quoted = true
    } else if (char === ",") {
      record.push(cell)
      cell = ""
    } else if (char === "\n" || char === "\r") {
      record.push(cell)
      records.push(record)
      record = []
      cell = ""
      if (char === "\r" && text[i + 1] === "\n") i += 1
    } else {
      cell += char
    }
    i += 1
  }
  if (quoted) return null
  if (cell !== "" || record.length > 0) {
    record.push(cell)
    records.push(record)
  }
  return records
}

function escapeCell(value: string): string {
  const safe = FORMULA_START.test(value) ? `'${value}` : value
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// Undoes escapeCell's apostrophe, so a refused-rows file fixed and uploaded
// again reads the values it was written from.
export function unescapeCell(value: string): string {
  return value.startsWith("'") && FORMULA_START.test(value.slice(1)) ? value.slice(1) : value
}

// A CSV file's text, CRLF line ends, every cell guarded against formulas.
export function toCsv(records: readonly (readonly string[])[]): string {
  return records.map((record) => record.map(escapeCell).join(",") + "\r\n").join("")
}
