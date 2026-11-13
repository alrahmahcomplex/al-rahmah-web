import { describe, expect, it } from "vitest"

import { readImportFile } from "@/lib/import"
import {
  STUDENT_IMPORT_COLUMNS,
  STUDENT_IMPORT_TEMPLATE,
  applyStudentVerdicts,
  confirmationOf,
  parseClass,
  parseDayOrBoarding,
  parseDiscountCode,
  parseImportDate,
  parseRelationship,
  parseStatus,
  refusedStudentRowsCsv,
  rowToDb,
  screenStudentRows,
  studentImportSummary,
  verdictFromDb,
  verdictToDb,
  withChanges,
  type StudentVerdict,
} from "@/lib/student-import"

// The student import's file rules: reading workbook values as the database
// stores them, and the checks a file fails on its own. Invented data only.

const TODAY = "2026-11-09"
const HEADER = "Student name,Class,Enrollment year,Day or boarding,Parent/guardian name,Relationship,Parent phone,WhatsApp,Visit date,Discount code,Status"

function read(lines: string[]) {
  const file = readImportFile(new TextEncoder().encode([HEADER, ...lines].join("\r\n")), STUDENT_IMPORT_COLUMNS)
  if (!file.ok) throw new Error(JSON.stringify(file.error))
  return screenStudentRows(file.data.rows, TODAY)
}

describe("the template", () => {
  it("is the header row, in the documented order", () => {
    expect(STUDENT_IMPORT_TEMPLATE).toBe(`${HEADER}\r\n`)
  })

  it("accepts the workbook's own headers, and leaves out the optional columns", () => {
    const file = readImportFile(
      new TextEncoder().encode("Name,Class name,Year,Parent/guardian contacts,Mobile\r\nAsha Mfano,STD 1,2027,Mama Mfano,0712000001\r\n"),
      STUDENT_IMPORT_COLUMNS,
    )
    expect(file.ok && file.data.rows[0].cells).toMatchObject({ studentName: "Asha Mfano", guardianName: "Mama Mfano", phone: "0712000001", status: "" })
  })

  it("says which required columns are missing", () => {
    const file = readImportFile(new TextEncoder().encode("Student name,Class\r\nA,STD 1\r\n"), STUDENT_IMPORT_COLUMNS)
    expect(file).toEqual({ ok: false, error: { kind: "missing-columns", columns: ["Enrollment year", "Parent/guardian name", "Parent phone"] } })
  })
})

describe("reading values", () => {
  it("reads classes as the system names them, and PRE-FORM ONE as FORM 1 with the programme", () => {
    expect(parseClass("std 1")).toEqual({ className: "STD 1", preFormOne: false })
    expect(parseClass("Form One")).toEqual({ className: "FORM 1", preFormOne: false })
    expect(parseClass("KG2")).toEqual({ className: "KG 2", preFormOne: false })
    expect(parseClass("Day care")).toEqual({ className: "DAY CARE", preFormOne: false })
    for (const typed of ["PRE-FORM ONE", "PRE FORM 1", "pre-form 1"]) expect(parseClass(typed)).toEqual({ className: "FORM 1", preFormOne: true })
    expect(parseClass("GRADE 9")).toBeNull()
    expect(parseClass("")).toBeNull()
  })

  it("reads Day or boarding, empty as Day", () => {
    expect(parseDayOrBoarding("")).toBe("Day")
    expect(parseDayOrBoarding("BOARDING")).toBe("Boarding")
    expect(parseDayOrBoarding("weekly")).toBeNull()
  })

  it("reads the relationship, empty as Other Parent/guardian and anything else as Other with its words", () => {
    expect(parseRelationship("mother")).toEqual({ relationship: "Mother", description: null })
    expect(parseRelationship("")).toEqual({ relationship: "Other", description: "Parent/guardian" })
    expect(parseRelationship(" Aunt ")).toEqual({ relationship: "Other", description: "Aunt" })
    expect(parseRelationship("x".repeat(101))).toBeNull()
  })

  it("reads dd/mm/yyyy, yyyy-mm-dd and d-MMM-yy, and refuses dates that don't exist", () => {
    expect(parseImportDate("05/09/2026")).toBe("2026-09-05")
    expect(parseImportDate("5.9.2026")).toBe("2026-09-05")
    expect(parseImportDate("2026-09-05")).toBe("2026-09-05")
    expect(parseImportDate("6-Sep-26")).toBe("2026-09-06")
    expect(parseImportDate("6 September 2026")).toBe("2026-09-06")
    expect(parseImportDate("31/02/2026")).toBeNull()
    expect(parseImportDate("Sept 6")).toBeNull()
  })

  it("reads a code as agent codes are stored, blanks and placeholders as no code", () => {
    expect(parseDiscountCode(" bjn - 402 ")).toBe("BJN-402")
    for (const none of ["", "-", "N/A", "none", "Hakuna"]) expect(parseDiscountCode(none)).toBeNull()
    expect(parseDiscountCode("bad/code")).toBeUndefined()
  })

  it("reads Contracted as Enrolled, and an empty status from the Visit date", () => {
    expect(parseStatus("Contracted", false)).toBe("Enrolled")
    expect(parseStatus("interviewed", false)).toBe("Interviewed")
    expect(parseStatus("", true)).toBe("Visited")
    expect(parseStatus("", false)).toBe("Applied")
    expect(parseStatus("Paid", false)).toBeNull()
  })
})

describe("the file's own checks", () => {
  it("normalises a good row as the database stores it", () => {
    const [row] = read(["  Asha   Mfano ,PRE-FORM ONE,2027,boarding,Mama  Mfano,Aunt,0712 000 001,0712000001,05/09/2026,bjn-402,Contracted"])
    expect(row.problem).toBeNull()
    expect(rowToDb(row)).toEqual({
      sheet_row: 2,
      student_name: "Asha Mfano",
      class_name: "FORM 1",
      pre_form_one: true,
      enrollment_year: 2027,
      day_or_boarding: "Boarding",
      guardian_name: "Mama Mfano",
      relationship: "Other",
      relationship_description: "Aunt",
      phone: "+255712000001",
      whatsapp: null,
      visit_date: "2026-09-05",
      referral_code: "BJN-402",
      status: "Enrolled",
    })
  })

  it("refuses each kind of bad value with its reason, and flags Excel numbers", () => {
    const rows = read([
      ",STD 1,2027,,Mama,,0712000001,,,,",
      "Kid,GRADE 9,2027,,Mama,,0712000001,,,,",
      "Kid,STD 1,2020,,Mama,,0712000001,,,,",
      "Kid,STD 1,2027,weekly,Mama,,0712000001,,,,",
      "Kid,STD 1,2027,,,,0712000001,,,,",
      "Kid,STD 1,2027,,Mama,,,,,,",
      "Kid,STD 1,2027,,Mama,,0712,,,,",
      "Kid,STD 1,2027,,Mama,,0712000001,abc,,,",
      "Kid,STD 1,2027,,Mama,,0712000001,,31/02/2026,,",
      "Kid,STD 1,2027,,Mama,,0712000001,,01/01/2027,,",
      "Kid,STD 1,2027,,Mama,,0712000001,,,bad/code,",
      "Kid,STD 1,2027,,Mama,,0712000001,,,,Paid",
      "Kid,STD 1,2027,,Mama,,712000012.0,,,,",
    ])
    expect(rows.map((row) => row.problem)).toEqual([
      { class: "refused", reason: "Missing student name" },
      { class: "refused", reason: "Unknown class" },
      { class: "refused", reason: "Enrollment year must be 2025 to 2028" },
      { class: "refused", reason: "Day or boarding not recognised" },
      { class: "refused", reason: "Missing parent/guardian name" },
      { class: "refused", reason: "Parent phone missing" },
      { class: "refused", reason: "Unreadable parent phone" },
      { class: "refused", reason: "Unreadable WhatsApp" },
      { class: "refused", reason: "Unreadable visit date" },
      { class: "refused", reason: "Visit date in the future" },
      { class: "refused", reason: "Unreadable discount code" },
      { class: "refused", reason: "Unknown status" },
      { class: "flagged", reason: "Looks like an Excel number" },
    ])
  })

  it("accepts a visit dated today, and refuses one dated tomorrow", () => {
    const rows = read(["Kid,STD 1,2027,,Mama,,0712000001,,09/11/2026,,", "Kid Two,STD 1,2027,,Mama,,0712000002,,10/11/2026,,"])
    expect(rows.map((row) => row.problem)).toEqual([null, { class: "refused", reason: "Visit date in the future" }])
  })

  it("refuses a student named twice with the same parent phone, and keeps siblings", () => {
    const rows = read([
      "Asha Mfano,STD 1,2027,,Mama,,0712000001,,,,",
      "asha  mfano,STD 2,2027,,Mama,,+255 712 000 001,,,,",
      "Baraka Mfano,STD 3,2027,,Mama,,0712000001,,,,",
    ])
    expect(rows.map((row) => row.problem?.reason ?? null)).toEqual([
      "Same student twice in the file (rows 2, 3)",
      "Same student twice in the file (rows 2, 3)",
      null,
    ])
  })

  it("refuses a student named twice when the rows share any parent number, phone or WhatsApp", () => {
    const rows = read([
      // The same child with the two numbers swapped.
      "Asha Mfano,STD 1,2027,,Mama,,0712000001,0712000002,,,",
      "Asha Mfano,STD 1,2027,,Mama,,0712000002,0712000001,,,",
      // One row's WhatsApp is the other's phone.
      "Juma Mfano,STD 2,2027,,Baba,,0712000003,0712000004,,,",
      "Juma Mfano,STD 2,2027,,Baba,,0712000004,,,,",
      // A sibling on the same numbers is another child.
      "Baraka Mfano,STD 3,2027,,Mama,,0712000002,0712000001,,,",
      // The same name with no number in common is another family's child.
      "Asha Mfano,STD 1,2027,,Mama Mwingine,,0712000009,,,,",
    ])
    expect(rows.map((row) => row.problem?.reason ?? null)).toEqual([
      "Same student twice in the file (rows 2, 3)",
      "Same student twice in the file (rows 2, 3)",
      "Same student twice in the file (rows 4, 5)",
      "Same student twice in the file (rows 4, 5)",
      null,
      null,
    ])
  })

  // #284: rows sharing a parent phone share one contact, the first row's, so
  // each row's application is stored under its phone and the WhatsApp numbers
  // of the rows sharing that phone.
  it("refuses a student named twice under two numbers a sibling row links", () => {
    const rows = read([
      "Baraka Mfano,STD 3,2027,,Mama,,0712000001,0712000002,,,",
      "Asha Mfano,STD 1,2027,,Mama,,0712000001,,,,",
      "Asha Mfano,STD 1,2027,,Mama,,0712000002,,,,",
    ])
    expect(rows.map((row) => row.problem?.reason ?? null)).toEqual([
      null,
      "Same student twice in the file (rows 3, 4)",
      "Same student twice in the file (rows 3, 4)",
    ])
  })

  it("links the WhatsApp of every row with the phone, not only the first row's", () => {
    const rows = read([
      "Baraka Mfano,STD 3,2027,,Mama,,0712000001,,,,",
      "Juma Mfano,STD 2,2027,,Mama,,0712000001,0712000002,,,",
      "Neema Mfano,STD 4,2027,,Mama,,0712000001,0712000003,,,",
      "Asha Mfano,STD 1,2027,,Mama,,0712000001,,,,",
      "Asha Mfano,STD 1,2027,,Mama,,0712000003,,,,",
    ])
    expect(rows.map((row) => row.problem?.reason ?? null)).toEqual([
      null,
      null,
      null,
      "Same student twice in the file (rows 5, 6)",
      "Same student twice in the file (rows 5, 6)",
    ])
  })

  it("keeps siblings who share the linked numbers as two children", () => {
    const rows = read([
      "Baraka Mfano,STD 3,2027,,Mama,,0712000001,0712000002,,,",
      "Asha Mfano,STD 1,2027,,Mama,,0712000001,,,,",
      "Juma Mfano,STD 2,2027,,Mama,,0712000002,,,,",
    ])
    expect(rows.map((row) => row.problem)).toEqual([null, null, null])
  })
})

describe("the database's verdicts", () => {
  const rows = read([
    "Asha Mfano,STD 1,2027,,Mama,,0712000001,,,,Interviewed",
    "Baraka Mfano,STD 2,2027,,Mama,,0712000001,,,XYZ1,",
    "Chausiku Mfano,STD 3,2027,,Mama,,0712000002,,,,",
    "Dotto Mfano,STD 3,2027,,Mama,,0712000003,,,,",
    "Bad Mfano,GRADE 9,2027,,Mama,,0712000004,,,,",
  ])
  const verdicts = new Map<number, StudentVerdict>([
    [2, { verdict: "create", familyRow: null, family: null, unknownCode: false }],
    [3, { verdict: "create", familyRow: 2, family: null, unknownCode: true }],
    [4, { verdict: "joins_family", familyRow: null, family: { contactId: "c1", fullName: "Juma Mfano" }, unknownCode: false }],
    [5, { verdict: "present", lead: { id: "l1", admissionNumber: "ADMSN-90001", status: "Visited" } }],
  ])
  const classified = applyStudentVerdicts(rows, verdicts)

  it("classes each row and explains what staff need to know", () => {
    expect(classified.map((row) => [row.class, row.reason, row.notes])).toEqual([
      ["create", null, ["No visit date in the file. The import date is used."]],
      ["create", null, ["Same parent as row 2", "Code not recognised. It stays on the application and gives no discount."]],
      ["joins-family", null, ["Phone matches Juma Mfano's family. Staff confirm the match on the application."]],
      ["present", "Already on file as ADMSN-90001", []],
      ["refused", "Unknown class", []],
    ])
    expect(studentImportSummary(classified)).toEqual({
      total: 5,
      create: 2,
      "joins-family": 1,
      present: 1,
      flagged: 0,
      refused: 1,
      skipped: 2,
    })
  })

  it("sends only the rows the database checked, and reads changed verdicts back", () => {
    const confirmation = confirmationOf({ fileName: "mfano.csv", rows: classified })
    expect(confirmation.rowCount).toBe(5)
    expect(confirmation.rows.map((row) => row.sheetRow)).toEqual([2, 3, 4, 5])
    const changed = withChanges(classified, [{ sheetRow: 2, verdict: { verdict: "present", lead: { id: "l2", admissionNumber: "ADMSN-90002", status: "Applied" } } }])
    expect(changed.map((row) => [row.class, row.changed])).toEqual([
      ["present", true],
      ["create", false],
      ["joins-family", false],
      ["present", false],
      ["refused", false],
    ])
  })

  it("round-trips every verdict through the database's shape", () => {
    for (const verdict of verdicts.values()) expect(verdictFromDb(verdictToDb(verdict))).toEqual(verdict)
    expect(verdictFromDb({ verdict: "refused", field: "phone" })).toEqual({ verdict: "refused", field: "phone" })
  })

  it("writes the refused rows back as uploaded, with the reason", () => {
    expect(refusedStudentRowsCsv(classified).split("\r\n")[1]).toBe("Bad Mfano,GRADE 9,2027,,Mama,,0712000004,,,,,Unknown class,6")
  })
})
