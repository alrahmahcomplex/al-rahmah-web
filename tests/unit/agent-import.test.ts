import { describe, expect, test } from "vitest"

import {
  AGENT_IMPORT_COLUMNS,
  AGENT_IMPORT_TEMPLATE,
  agentImportSummary,
  applyAgentVerdicts,
  confirmLabel,
  normalizeAgentCode,
  normalizeAgentPhone,
  refusedAgentRowsCsv,
  screenAgentRows,
  type AgentImportRow,
  type AgentVerdict,
} from "@/lib/agent-import"
import { readImportFile } from "@/lib/import"

// The agent import's own rules on top of the import module (#190): the
// template's columns, normalising each value, the checks a file can fail on
// its own, and how the database's verdict on each remaining row reads.

const HEADER = "Code,Full name,Mobile,WhatsApp,Email\n"

function screen(body: string) {
  const file = readImportFile(new TextEncoder().encode(HEADER + body), AGENT_IMPORT_COLUMNS)
  if (!file.ok) throw new Error(JSON.stringify(file.error))
  return screenAgentRows(file.data.rows)
}

const reasonOf = (rows: ReturnType<typeof screen>, sheetRow: number) => rows.find((row) => row.sheetRow === sheetRow)?.problem

describe("the template", () => {
  test("has the columns code, full name, mobile, WhatsApp and email, and nothing else", () => {
    expect(AGENT_IMPORT_TEMPLATE).toBe("Code,Full name,Mobile,WhatsApp,Email\r\n")
    expect(AGENT_IMPORT_COLUMNS.map((column) => column.header)).toEqual(["Code", "Full name", "Mobile", "WhatsApp", "Email"])
  })
})

describe("normalising, as the database does", () => {
  test.each([
    ["0712 345 678", "+255712345678"],
    ["712345678", "+255712345678"],
    ["255712345678", "+255712345678"],
    ["+255 (712) 345-678", "+255712345678"],
    ["+44 20 7946 0958", "+442079460958"],
    ["+25571234567", null],
    ["0712", null],
    ["phone", null],
  ])("the phone %s reads as %s", (raw, expected) => {
    expect(normalizeAgentPhone(raw)).toBe(expected)
  })

  test.each([
    [" ajm-407 ", "AJM-407"],
    ["AJM -407", "AJM-407"],
    ["a.b-1", "A.B-1"],
    ["AJM_407", null],
    ["ß-1", null],
    ["ABCDEFGHIJKLMNOPQRSTU", null],
  ])("the code %s reads as %s", (raw, expected) => {
    expect(normalizeAgentCode(raw)).toBe(expected)
  })

  test("keeps the original value beside the normalised one", () => {
    const [row] = screen(" ajm-407 ,  Asha   Juma ,0712 345 678, 0712345678 , Asha@Example.TEST \n")
    expect(row).toMatchObject({
      sheetRow: 2,
      original: { code: " ajm-407 ", fullName: "  Asha   Juma ", mobile: "0712 345 678", whatsapp: " 0712345678 ", email: " Asha@Example.TEST " },
      // A WhatsApp number equal to the mobile is dropped, as the database stores it.
      normalized: { code: "AJM-407", fullName: "Asha Juma", mobile: "+255712345678", whatsapp: null, email: "asha@example.test" },
      problem: null,
    })
  })
})

describe("what a file can be refused for on its own", () => {
  test("each reason, worded as the ticket gives it", () => {
    const rows = screen(
      [
        "AJM-1,,0712000001,,", // 2 missing name
        "AJM_1,Asha Juma,0712000002,,", // 3 bad code
        ",Asha Juma,0712000003,,", // 4 bad code (none)
        "AJM-4,Asha Juma,,,", // 5 mobile missing
        "AJM-5,Asha Juma,0712,,", // 6 unreadable mobile
        "DUP-1,Asha Juma,0712000007,,", // 7 duplicate code
        "dup-1 ,Baraka Ali,0712000008,,", // 8 duplicate code
        "AJM-9,Asha Juma,0712000009,,", // 9 duplicate mobile
        "AJM-10,Asha Juma,+255 712 000 009,,", // 10 duplicate mobile
        "AJM-11,Asha Juma,7.12E+08,,", // 11 flagged
        "AJM-12,Asha Juma,712000012.0,,", // 12 flagged
        "1.2E+05,Asha Juma,0712000013,,", // 13 flagged
        "AJM-14,Asha Juma,0712000014,0712,", // 14 unreadable WhatsApp
        "AJM-15,Asha Juma,0712000015,,not-an-email", // 15 unreadable email
        "AJM-16,Asha Juma,0712000016,,same@example.test", // 16 duplicate email
        "AJM-17,Asha Juma,0712000017,,SAME@example.test", // 17 duplicate email
        `AJM-18,${"A".repeat(101)},0712000018,,`, // 18 name too long
        "AJM-19,Asha Juma,0712000019,,", // 19 fine
        "DUP-1,Chausiku,0712000020,,", // 20 duplicate code
      ].join("\n"),
    )
    expect(reasonOf(rows, 2)).toEqual({ class: "refused", reason: "Missing name" })
    expect(reasonOf(rows, 3)).toEqual({ class: "refused", reason: "Bad code" })
    expect(reasonOf(rows, 4)).toEqual({ class: "refused", reason: "Bad code" })
    expect(reasonOf(rows, 5)).toEqual({ class: "refused", reason: "Mobile missing" })
    expect(reasonOf(rows, 6)).toEqual({ class: "refused", reason: "Unreadable mobile" })
    expect(reasonOf(rows, 7)).toEqual({ class: "refused", reason: "Duplicate code in file (rows 7, 8, 20)" })
    expect(reasonOf(rows, 8)).toEqual({ class: "refused", reason: "Duplicate code in file (rows 7, 8, 20)" })
    expect(reasonOf(rows, 20)).toEqual({ class: "refused", reason: "Duplicate code in file (rows 7, 8, 20)" })
    expect(reasonOf(rows, 9)).toEqual({ class: "refused", reason: "Duplicate mobile in file" })
    expect(reasonOf(rows, 10)).toEqual({ class: "refused", reason: "Duplicate mobile in file" })
    expect(reasonOf(rows, 11)).toEqual({ class: "flagged", reason: "Looks like an Excel number" })
    expect(reasonOf(rows, 12)).toEqual({ class: "flagged", reason: "Looks like an Excel number" })
    expect(reasonOf(rows, 13)).toEqual({ class: "flagged", reason: "Looks like an Excel number" })
    expect(reasonOf(rows, 14)).toEqual({ class: "refused", reason: "Unreadable WhatsApp" })
    expect(reasonOf(rows, 15)).toEqual({ class: "refused", reason: "Unreadable email" })
    expect(reasonOf(rows, 16)).toEqual({ class: "refused", reason: "Duplicate email in file" })
    expect(reasonOf(rows, 17)).toEqual({ class: "refused", reason: "Duplicate email in file" })
    expect(reasonOf(rows, 18)).toEqual({ class: "refused", reason: "Name too long" })
    expect(reasonOf(rows, 19)).toBeNull()
  })

  test("a row with a name of one letter has no name", () => {
    expect(reasonOf(screen("AJM-1,A,0712000001,,\n"), 2)).toEqual({ class: "refused", reason: "Missing name" })
  })
})

const AGENT = { id: "agent-1", fullName: "Asha Juma", code: "AJM-1", phone: "+255712000001", email: null }

function checked(verdicts: Record<number, AgentVerdict>) {
  const rows = screen(
    [
      "AJM-1,Asha Juma,0712000001,,", // 2
      "AJM-2,Baraka Ali,0712000002,,", // 3
      "AJM-3,Chausiku,0712000003,,", // 4
      "AJM-4,Dotto,0712000004,,", // 5
      "AJM-5,Eliya,0712000005,,", // 6
      "AJM-6,Fatma,0712000006,,", // 7
      "AJM-7,Gift,0712000007,,", // 8
      "AJM-8,Halima,0712000008,,", // 9
      "AJM-9,Idd,0712000009,,", // 10
      ",Bad Code,0712000010,,", // 11
    ].join("\n"),
  )
  return applyAgentVerdicts(rows, new Map(Object.entries(verdicts).map(([row, verdict]) => [Number(row), verdict])))
}

describe("reading the database's verdict on each row", () => {
  const rows = checked({
    2: { verdict: "create" },
    3: { verdict: "present", agent: AGENT },
    4: { verdict: "email_to_add", agent: AGENT },
    5: { verdict: "email_differs", agent: { ...AGENT, email: "old@example.test" } },
    6: { verdict: "mobile_differs", agent: AGENT },
    7: { verdict: "code_exists", agent: AGENT },
    8: { verdict: "retired_code" },
    9: { verdict: "mobile_taken", agent: AGENT },
    10: { verdict: "email_taken" },
  })
  const row = (sheetRow: number) => rows.find((r) => r.sheetRow === sheetRow) as AgentImportRow

  test("each class and refusal, worded as the ticket gives it", () => {
    expect(row(2)).toMatchObject({ class: "create", reason: null })
    expect(row(3)).toMatchObject({ class: "present", reason: null, agent: AGENT })
    expect(row(4)).toMatchObject({ class: "email-to-add", reason: null })
    expect(row(5)).toMatchObject({ class: "email-differs", reason: "Email differs (not changed)" })
    expect(row(6)).toMatchObject({ class: "mobile-differs", reason: "Mobile differs (not changed)" })
    expect(row(7)).toMatchObject({ class: "refused", reason: "Code exists as Asha Juma" })
    expect(row(8)).toMatchObject({ class: "refused", reason: "Code belongs to a retired record (use Recreate)" })
    expect(row(9)).toMatchObject({ class: "refused", reason: "Mobile already belongs to Asha Juma, AJM-1" })
    expect(row(10)).toMatchObject({ class: "refused", reason: "Email already in use" })
    expect(row(11)).toMatchObject({ class: "refused", reason: "Bad code", verdict: null })
  })

  test("keeps the verdict on every row the database checked, for confirm to re-check", () => {
    expect(row(2).verdict).toEqual({ verdict: "create" })
    expect(row(7).verdict).toEqual({ verdict: "code_exists", agent: AGENT })
  })

  test("counts each class; the confirm button says what it does", () => {
    const summary = agentImportSummary(rows)
    expect(summary).toEqual({
      total: 10,
      create: 1,
      present: 1,
      "email-to-add": 1,
      "email-differs": 1,
      "mobile-differs": 1,
      flagged: 0,
      refused: 5,
      skipped: 8,
    })
    expect(confirmLabel(summary)).toBe("Create 1 agent, add 1 email, skip 8 rows")
    expect(confirmLabel({ ...summary, create: 42, "email-to-add": 0, skipped: 3 })).toBe("Create 42 agents, skip 3 rows")
    expect(confirmLabel({ ...summary, create: 2, "email-to-add": 0, skipped: 0 })).toBe("Create 2 agents")
    expect(confirmLabel({ ...summary, create: 0, "email-to-add": 2, skipped: 1 })).toBe("Add 2 emails, skip 1 row")
  })
})

describe("the refused-rows file", () => {
  test("holds the refused and flagged rows as uploaded, with each reason and sheet row, guarded against formulas", () => {
    const rows = screen(["AJM-1,=HYPERLINK(1),0712000001,,", "AJM-2,Baraka,7.12E+08,,", "AJM-3,Chausiku,0712000003,,"].join("\n"))
    const all = applyAgentVerdicts(rows, new Map([[2, { verdict: "create" } as const], [4, { verdict: "retired_code" } as const]]))
    expect(refusedAgentRowsCsv(all)).toBe(
      "Code,Full name,Mobile,WhatsApp,Email,Reason,Sheet row\r\n" +
        "AJM-2,Baraka,7.12E+08,,,Looks like an Excel number,3\r\n" +
        "AJM-3,Chausiku,0712000003,,,Code belongs to a retired record (use Recreate),4\r\n",
    )
    const injected = applyAgentVerdicts(rows, new Map([[2, { verdict: "retired_code" } as const], [4, { verdict: "create" } as const]]))
    expect(refusedAgentRowsCsv(injected)).toContain("AJM-1,'=HYPERLINK(1),0712000001,,,Code belongs to a retired record (use Recreate),2\r\n")
  })
})
