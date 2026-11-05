import { describe, expect, test } from "vitest"

import { findDuplicates, IMPORT_LIMITS, importFileMessage, readImportFile, toCsv, type ImportColumn } from "@/lib/import"

// The reusable import module (#190): reading a CSV file within the limits,
// matching its columns, finding duplicates and writing a CSV back. It knows
// nothing about agents; the student import reuses it.

const COLUMNS: ImportColumn<"code" | "name" | "phone">[] = [
  { key: "code", header: "Code" },
  { key: "name", header: "Full name", aliases: ["name"] },
  { key: "phone", header: "Mobile", aliases: ["phone"] },
]

const encode = (text: string) => new TextEncoder().encode(text)
const read = (text: string | Uint8Array) => readImportFile(typeof text === "string" ? encode(text) : text, COLUMNS)

describe("reading a file", () => {
  test("reads each row with its sheet row number, the header being row 1", () => {
    expect(read("Code,Full name,Mobile\nAB-1,Asha Juma,0712345678\nAB-2,Baraka Ali,0712345679\n")).toEqual({
      ok: true,
      data: {
        rows: [
          { sheetRow: 2, cells: { code: "AB-1", name: "Asha Juma", phone: "0712345678" } },
          { sheetRow: 3, cells: { code: "AB-2", name: "Baraka Ali", phone: "0712345679" } },
        ],
      },
    })
  })

  test("accepts UTF-8 with or without a byte-order mark, and CRLF line ends", () => {
    const text = "Code,Full name,Mobile\r\nAB-1,Zuhura Mwanaidi Ñ,0712345678\r\n"
    const withBom = new Uint8Array([0xef, 0xbb, 0xbf, ...encode(text)])
    const expected = { ok: true, data: { rows: [{ sheetRow: 2, cells: { code: "AB-1", name: "Zuhura Mwanaidi Ñ", phone: "0712345678" } }] } }
    expect(read(text)).toEqual(expected)
    expect(read(withBom)).toEqual(expected)
  })

  test("matches headers ignoring case, spacing, underscores and order, and by alias; ignores other columns", () => {
    const result = read("  mobile ,Notes, FULL_NAME,code,Reason\n0712345678,x,Asha Juma,AB-1,old reason\n")
    expect(result).toEqual({ ok: true, data: { rows: [{ sheetRow: 2, cells: { code: "AB-1", name: "Asha Juma", phone: "0712345678" } }] } })
    expect(read("Code,Name,Phone\nAB-1,Asha,0712\n")).toMatchObject({ ok: true })
  })

  test("reads quoted cells with commas, quotes and line breaks; a quoted line break stays in one sheet row", () => {
    const result = read('Code,Full name,Mobile\n"AB-1","Juma, ""Mzee"" Ali",0712\n"AB-2","Two\nLines",0713\nAB-3,Three,0714\n')
    expect(result).toEqual({
      ok: true,
      data: {
        rows: [
          { sheetRow: 2, cells: { code: "AB-1", name: 'Juma, "Mzee" Ali', phone: "0712" } },
          { sheetRow: 3, cells: { code: "AB-2", name: "Two\nLines", phone: "0713" } },
          { sheetRow: 4, cells: { code: "AB-3", name: "Three", phone: "0714" } },
        ],
      },
    })
  })

  test("skips blank rows but keeps counting them, so row numbers match the sheet", () => {
    const result = read("Code,Full name,Mobile\n\n,,\nAB-1,Asha,0712\n")
    expect(result).toEqual({ ok: true, data: { rows: [{ sheetRow: 4, cells: { code: "AB-1", name: "Asha", phone: "0712" } }] } })
  })

  test("a short row reads its missing cells as empty", () => {
    expect(read("Code,Full name,Mobile\nAB-1\n")).toEqual({ ok: true, data: { rows: [{ sheetRow: 2, cells: { code: "AB-1", name: "", phone: "" } }] } })
  })

  test("undoes the formula escape the refused-rows file adds, so a fixed file reads back the same", () => {
    const csv = toCsv([["Code", "Full name", "Mobile"], ["AB-1", "=Asha", "+255712345678"]])
    expect(read(csv)).toEqual({ ok: true, data: { rows: [{ sheetRow: 2, cells: { code: "AB-1", name: "=Asha", phone: "+255712345678" } }] } })
  })
})

describe("the file limits", () => {
  test(`refuses a file over ${IMPORT_LIMITS.maxBytes} bytes (256 KB)`, () => {
    const header = "Code,Full name,Mobile\n"
    const exact = header + "x".repeat(IMPORT_LIMITS.maxBytes - header.length)
    expect(read(exact)).not.toMatchObject({ ok: false, error: { kind: "too-large" } })
    expect(read(exact + "x")).toEqual({ ok: false, error: { kind: "too-large", maxBytes: 262_144 } })
  })

  test("refuses more than 1,000 rows, counting rows that hold anything", () => {
    const rows = (n: number) => "Code,Full name,Mobile\n" + Array.from({ length: n }, (_, i) => `C-${i},Name ${i},07${i}\n`).join("")
    expect(read(rows(1000))).toMatchObject({ ok: true })
    expect(read(rows(1001))).toEqual({ ok: false, error: { kind: "too-many-rows", maxRows: 1000, rows: 1001 } })
    expect(read(rows(1000) + "\n\n,,\n")).toMatchObject({ ok: true })
  })

  test("refuses a file that isn't UTF-8", () => {
    // "Zuhura" with a Windows-1252 é, as Excel's plain CSV writes it.
    const latin1 = new Uint8Array([...encode("Code,Full name,Mobile\nAB-1,Ren"), 0xe9, ...encode(",0712\n")])
    expect(read(latin1)).toEqual({ ok: false, error: { kind: "not-utf8" } })
  })

  test("refuses an empty file, a file with only a header, and a file missing a column", () => {
    expect(read("")).toEqual({ ok: false, error: { kind: "empty" } })
    expect(read("Code,Full name,Mobile\n")).toEqual({ ok: false, error: { kind: "empty" } })
    expect(read("Code,Mobile\nAB-1,0712\n")).toEqual({ ok: false, error: { kind: "missing-columns", columns: ["Full name"] } })
  })

  test("refuses a quote left open", () => {
    expect(read('Code,Full name,Mobile\n"AB-1,Asha,0712\n')).toEqual({ ok: false, error: { kind: "unreadable" } })
  })

  test("every refusal has an English and a Swahili message", () => {
    const errors = [
      { kind: "too-large", maxBytes: 262_144 },
      { kind: "too-many-rows", maxRows: 1000, rows: 1240 },
      { kind: "not-utf8" },
      { kind: "empty" },
      { kind: "missing-columns", columns: ["Full name", "Mobile"] },
      { kind: "unreadable" },
    ] as const
    for (const error of errors) {
      const message = importFileMessage(error)
      expect(message.en).toMatch(/\S/)
      expect(message.sw).toMatch(/\S/)
      expect(message.sw).not.toBe(message.en)
    }
    expect(importFileMessage({ kind: "too-large", maxBytes: 262_144 })).toEqual({
      en: "This file is larger than 256 KB. Split it into smaller files and upload each one.",
      sw: "Faili hili ni kubwa kuliko KB 256. Ligawe katika mafaili madogo, kisha pakia moja moja.",
    })
    expect(importFileMessage({ kind: "too-many-rows", maxRows: 1000, rows: 1240 })).toEqual({
      en: "This file has 1,240 rows. Upload at most 1,000 rows at a time.",
      sw: "Faili hili lina safu 1,240. Pakia safu zisizozidi 1,000 kwa wakati mmoja.",
    })
    expect(importFileMessage({ kind: "missing-columns", columns: ["Full name", "Mobile"] }).en).toBe(
      "This file has no Full name or Mobile column. Use the template's first row as the header.",
    )
  })
})

describe("finding duplicates", () => {
  test("gives every row sharing a key all the rows that share it; empty keys never match", () => {
    const duplicates = findDuplicates([
      { sheetRow: 2, key: "A" },
      { sheetRow: 3, key: "B" },
      { sheetRow: 4, key: "A" },
      { sheetRow: 5, key: null },
      { sheetRow: 6, key: null },
      { sheetRow: 7, key: "A" },
    ])
    expect([...duplicates.entries()]).toEqual([
      [2, [2, 4, 7]],
      [4, [2, 4, 7]],
      [7, [2, 4, 7]],
    ])
  })
})

describe("writing a CSV", () => {
  test("quotes cells that need it", () => {
    expect(toCsv([["a", "b,c", 'say "hi"', "two\nlines"]])).toBe('a,"b,c","say ""hi""","two\nlines"\r\n')
  })

  test("escapes a cell a spreadsheet would read as a formula", () => {
    const csv = toCsv([["=1+1", "+255712345678", "-5", "@SUM(A1)", "\tx", "\rx", "safe=1"]])
    expect(csv).toBe(`'=1+1,'+255712345678,'-5,'@SUM(A1),'\tx,"'\rx",safe=1\r\n`)
  })
})
