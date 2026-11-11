import { normalizeAgentCode, normalizeAgentPhone } from "@/lib/agent-import"
import { findDuplicates, refusedRowsCsv, toCsv, type ImportColumn, type ImportRecord } from "@/lib/import"

// The student import's rules on top of the import module: the template's
// columns, reading each workbook value as the database stores it, the checks
// a file fails on its own, and the classes the review screen shows. Checks
// against leads already stored are the database's (check_student_import), and
// confirm re-checks them under its lock. Runs in the browser and on the
// server; reads no table.
//
// Not imported, by the owner's decision: interview payment, result, score,
// comments and follow-ups. Records start from the import date.

export type StudentImportKey =
  | "studentName"
  | "className"
  | "enrollmentYear"
  | "dayOrBoarding"
  | "guardianName"
  | "relationship"
  | "phone"
  | "whatsapp"
  | "visitDate"
  | "discountCode"
  | "status"

// The headers the template writes. The aliases are the workbook's own
// headers and other names a file may use. Only the student, class, year,
// parent and phone columns must be in the file.
export const STUDENT_IMPORT_COLUMNS: readonly ImportColumn<StudentImportKey>[] = [
  { key: "studentName", header: "Student name", aliases: ["name", "student"] },
  { key: "className", header: "Class", aliases: ["class name"] },
  { key: "enrollmentYear", header: "Enrollment year", aliases: ["year", "enrolment year"] },
  { key: "dayOrBoarding", header: "Day or boarding", aliases: ["day/boarding"], optional: true },
  { key: "guardianName", header: "Parent/guardian name", aliases: ["parent name", "guardian name", "parent/guardian contacts"] },
  { key: "relationship", header: "Relationship", optional: true },
  { key: "phone", header: "Parent phone", aliases: ["phone", "mobile", "contact"] },
  { key: "whatsapp", header: "WhatsApp", optional: true },
  { key: "visitDate", header: "Visit date", aliases: ["date"], optional: true },
  { key: "discountCode", header: "Discount code", aliases: ["code"], optional: true },
  { key: "status", header: "Status", aliases: ["customer journey"], optional: true },
]

// The template staff download: the header row only.
export const STUDENT_IMPORT_TEMPLATE = toCsv([STUDENT_IMPORT_COLUMNS.map((column) => column.header)])

export const IMPORT_CLASSES = [
  "DAY CARE",
  "KG 1",
  "KG 2",
  "STD 1",
  "STD 2",
  "STD 3",
  "STD 4",
  "STD 5",
  "STD 6",
  "STD 7",
  "FORM 1",
  "FORM 2",
  "FORM 3",
  "FORM 4",
] as const
export type ImportClass = (typeof IMPORT_CLASSES)[number]

export const IMPORT_STATUSES = ["Applied", "Visited", "Interviewed", "Enrolled", "Declined"] as const
export type ImportStatus = (typeof IMPORT_STATUSES)[number]

export type ImportRelationship = "Mother" | "Father" | "Guardian" | "Other"

// A row's values as the database stores them.
export type StudentImportValues = {
  studentName: string | null
  className: ImportClass | null
  preFormOne: boolean
  enrollmentYear: number | null
  dayOrBoarding: "Day" | "Boarding" | null
  guardianName: string | null
  relationship: ImportRelationship | null
  // Set exactly when the relationship is Other.
  relationshipDescription: string | null
  phone: string | null
  whatsapp: string | null
  // yyyy-mm-dd, or null.
  visitDate: string | null
  discountCode: string | null
  status: ImportStatus | null
}

// The review screen's classes. Only create and joins-family make a lead;
// every other row is skipped.
export const STUDENT_IMPORT_CLASSES = ["create", "joins-family", "present", "flagged", "refused"] as const
export type StudentImportClass = (typeof STUDENT_IMPORT_CLASSES)[number]

// The database's verdict on a row that passed the file's own checks.
export type StudentVerdict =
  | {
      verdict: "create" | "joins_family"
      // The first row in the file with the same parent phone, whose new
      // contact this row shares; null for that first row itself.
      familyRow: number | null
      // The known Family the row joins, pending staff confirmation.
      family: { contactId: string; fullName: string } | null
      // The code is kept on the lead though nobody holds it.
      unknownCode: boolean
    }
  | { verdict: "present"; lead: { id: string; admissionNumber: string; status: string } }
  | { verdict: "refused"; field: string }

export type ScreenedStudentRow = {
  sheetRow: number
  original: Record<StudentImportKey, string>
  normalized: StudentImportValues
  // Null when the row goes on to the database's check.
  problem: { class: "flagged" | "refused"; reason: string } | null
}

export type StudentImportRow = {
  sheetRow: number
  original: Record<StudentImportKey, string>
  normalized: StudentImportValues
  class: StudentImportClass
  // Why a row is skipped, when its class doesn't say it all.
  reason: string | null
  // What staff should know about a row that is created.
  notes: string[]
  // What the database said, for confirm to re-check; null for a row the
  // file's own checks stopped.
  verdict: StudentVerdict | null
  // Set when confirm found the row no longer as checked.
  changed?: boolean
}

// ---------------------------------------------------------------------------
// Reading values.
// ---------------------------------------------------------------------------

const collapse = (raw: string) => raw.replace(/\s+/g, " ").trim()

// The student's name as the database compares names: lowercase, single
// spaces. Two rows with the same key and the same parent phone are one child.
export function studentNameKey(name: string): string {
  return collapse(name).toLowerCase()
}

// A class as typed, or as the workbook writes it. PRE-FORM ONE is FORM 1 with
// the Pre-Form One programme ticked.
export function parseClass(raw: string): { className: ImportClass; preFormOne: boolean } | null {
  const compact = raw.toUpperCase().replace(/[\s_-]+/g, "")
  if (compact === "") return null
  if (["PREFORMONE", "PREFORM1", "PREF1"].includes(compact)) return { className: "FORM 1", preFormOne: true }
  const words: Record<string, string> = { ONE: "1", TWO: "2", THREE: "3", FOUR: "4", FIVE: "5", SIX: "6", SEVEN: "7" }
  const spelled = compact.replace(/(ONE|TWO|THREE|FOUR|FIVE|SIX|SEVEN)$/, (word) => words[word])
  const found = IMPORT_CLASSES.find((name) => name.replace(/\s/g, "") === spelled)
  return found ? { className: found, preFormOne: false } : null
}

export function parseDayOrBoarding(raw: string): "Day" | "Boarding" | null {
  const value = raw.trim().toLowerCase()
  if (value === "" || value === "day" || value === "d") return "Day"
  if (value === "boarding" || value === "boarder" || value === "b") return "Boarding"
  return null
}

// Mother, Father and Guardian as typed; anything else is Other with the
// words as its description; empty is Other, "Parent/guardian".
export function parseRelationship(raw: string): { relationship: ImportRelationship; description: string | null } | null {
  const value = collapse(raw)
  if (value === "") return { relationship: "Other", description: "Parent/guardian" }
  const known = (["Mother", "Father", "Guardian"] as const).find((name) => name.toLowerCase() === value.toLowerCase())
  if (known) return { relationship: known, description: null }
  if (value.toLowerCase() === "other") return { relationship: "Other", description: "Parent/guardian" }
  return value.length <= 100 ? { relationship: "Other", description: value } : null
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]

function isoDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
}

// dd/mm/yyyy (or d/m/yyyy, with / . or -), yyyy-mm-dd, and d-MMM-yy or
// d-MMM-yyyy (5-Sep-26). Two-digit years are 20xx.
export function parseImportDate(raw: string): string | null {
  const value = raw.trim()
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (match) return isoDate(Number(match[1]), Number(match[2]), Number(match[3]))
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(value)
  if (match) return isoDate(Number(match[3]), Number(match[2]), Number(match[1]))
  match = /^(\d{1,2})[\s-]([A-Za-z]{3,9})[\s-](\d{2}|\d{4})$/.exec(value)
  if (match) {
    const month = MONTHS.indexOf(match[2].slice(0, 3).toLowerCase())
    if (month === -1) return null
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3])
    return isoDate(year, month + 1, Number(match[1]))
  }
  return null
}

const NO_CODE = new Set(["", "-", "--", "n/a", "na", "none", "nil", "hakuna"])

// The code as normalize_referral_code stores it; undefined for a value that
// is no code at all. Blank and placeholders like "-" or "none" are no code.
export function parseDiscountCode(raw: string): string | null | undefined {
  if (NO_CODE.has(raw.trim().toLowerCase())) return null
  return normalizeAgentCode(raw) ?? undefined
}

// The workbook's "Contracted" is Enrolled. Empty is Visited with a Visit
// date and Applied without one.
export function parseStatus(raw: string, hasVisitDate: boolean): ImportStatus | null {
  const value = raw.trim().toLowerCase()
  if (value === "") return hasVisitDate ? "Visited" : "Applied"
  if (value === "contracted") return "Enrolled"
  return IMPORT_STATUSES.find((status) => status.toLowerCase() === value) ?? null
}

// A number Excel has turned into a figure: all digits with a decimal point or
// in scientific notation, which drops digits.
function looksLikeExcelNumber(raw: string): boolean {
  return /^[+-]?(\d+\.\d+|\d+(\.\d+)?[eE][+-]?\d+)$/.test(raw.trim())
}

// Today at the school, yyyy-mm-dd.
export function tanzaniaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(now)
}

// ---------------------------------------------------------------------------
// The file's own checks.
// ---------------------------------------------------------------------------

export const STUDENT_REASONS = {
  flagged: "Looks like an Excel number",
  missingName: "Missing student name",
  nameTooLong: "Student name too long",
  unknownClass: "Unknown class",
  missingYear: "Missing enrollment year",
  yearOutOfRange: (from: number, to: number) => `Enrollment year must be ${from} to ${to}`,
  unknownDayOrBoarding: "Day or boarding not recognised",
  missingGuardian: "Missing parent/guardian name",
  guardianTooLong: "Parent/guardian name too long",
  relationshipTooLong: "Relationship too long",
  phoneMissing: "Parent phone missing",
  unreadablePhone: "Unreadable parent phone",
  unreadableWhatsapp: "Unreadable WhatsApp",
  unreadableDate: "Unreadable visit date",
  futureDate: "Visit date in the future",
  unreadableCode: "Unreadable discount code",
  unknownStatus: "Unknown status",
  duplicateStudent: (rows: number[]) => `Same student twice in the file (rows ${rows.join(", ")})`,
  present: (admissionNumber: string) => `Already on file as ${admissionNumber}`,
  refusedByCheck: (field: string) => `Not accepted: ${field.replace(/_/g, " ")}`,
} as const

export const STUDENT_NOTES = {
  unknownCode: "Code not recognised. It stays on the application and gives no discount.",
  importDate: "No visit date in the file. The import date is used.",
  sameFamily: (row: number) => `Same parent as row ${row}`,
  joinsFamily: (name: string) => `Phone matches ${name}'s family. Staff confirm the match on the application.`,
} as const

export function screenStudentRows(
  records: readonly ImportRecord<StudentImportKey>[],
  today: string = tanzaniaToday(),
): ScreenedStudentRow[] {
  const thisYear = Number(today.slice(0, 4))
  const rows = records.map((record) => {
    const { cells } = record
    const studentName = collapse(cells.studentName)
    const guardianName = collapse(cells.guardianName)
    const klass = parseClass(cells.className)
    const relationship = parseRelationship(cells.relationship)
    const phone = normalizeAgentPhone(cells.phone)
    let whatsapp = cells.whatsapp.trim() === "" ? null : normalizeAgentPhone(cells.whatsapp)
    if (whatsapp !== null && whatsapp === phone) whatsapp = null
    const visitDate = cells.visitDate.trim() === "" ? null : parseImportDate(cells.visitDate)
    const year = /^\d{4}$/.test(cells.enrollmentYear.trim()) ? Number(cells.enrollmentYear.trim()) : null
    const code = parseDiscountCode(cells.discountCode)
    const normalized: StudentImportValues = {
      studentName: studentName === "" ? null : studentName,
      className: klass?.className ?? null,
      preFormOne: klass?.preFormOne ?? false,
      enrollmentYear: year,
      dayOrBoarding: parseDayOrBoarding(cells.dayOrBoarding),
      guardianName: guardianName === "" ? null : guardianName,
      relationship: relationship?.relationship ?? null,
      relationshipDescription: relationship?.description ?? null,
      phone,
      whatsapp,
      visitDate,
      discountCode: code ?? null,
      status: parseStatus(cells.status, visitDate !== null),
    }
    return { sheetRow: record.sheetRow, original: { ...cells }, normalized, codeUnreadable: code === undefined }
  })

  // The same student twice: the same name with any parent number in common,
  // as the database matches a student already on file. A row's numbers are
  // those its application is stored under: rows sharing a parent phone share
  // the first row's contact, so a row's numbers are its own phone and
  // WhatsApp plus the WhatsApp of every row with the same phone (#284). The
  // database compares the same numbers (student_import_rows).
  const linked = new Map<string, string[]>()
  for (const { phone, whatsapp } of rows.map((row) => row.normalized)) {
    if (phone !== null && whatsapp !== null) linked.set(phone, [...(linked.get(phone) ?? []), whatsapp])
  }
  const students = findDuplicates(
    rows.flatMap((row) => {
      const { studentName, phone, whatsapp } = row.normalized
      if (!studentName) return []
      const numbers = new Set([phone, whatsapp, ...(phone === null ? [] : (linked.get(phone) ?? []))].filter((number) => number !== null))
      return [...numbers].map((number) => ({ sheetRow: row.sheetRow, key: `${studentNameKey(studentName)}|${number}` }))
    }),
  )

  return rows.map(({ codeUnreadable, ...row }) => {
    const { original: o, normalized: n, sheetRow } = row
    const refused = (reason: string) => ({ class: "refused" as const, reason })
    let problem: ScreenedStudentRow["problem"] = null
    if (looksLikeExcelNumber(o.phone) || looksLikeExcelNumber(o.whatsapp)) problem = { class: "flagged", reason: STUDENT_REASONS.flagged }
    else if (n.studentName === null) problem = refused(STUDENT_REASONS.missingName)
    else if (n.studentName.length > 100) problem = refused(STUDENT_REASONS.nameTooLong)
    else if (n.className === null) problem = refused(STUDENT_REASONS.unknownClass)
    else if (n.enrollmentYear === null) problem = refused(STUDENT_REASONS.missingYear)
    else if (n.enrollmentYear < thisYear - 1 || n.enrollmentYear > thisYear + 2) problem = refused(STUDENT_REASONS.yearOutOfRange(thisYear - 1, thisYear + 2))
    else if (n.dayOrBoarding === null) problem = refused(STUDENT_REASONS.unknownDayOrBoarding)
    else if (n.guardianName === null) problem = refused(STUDENT_REASONS.missingGuardian)
    else if (n.guardianName.length > 100) problem = refused(STUDENT_REASONS.guardianTooLong)
    else if (n.relationship === null) problem = refused(STUDENT_REASONS.relationshipTooLong)
    else if (o.phone.trim() === "") problem = refused(STUDENT_REASONS.phoneMissing)
    else if (n.phone === null) problem = refused(STUDENT_REASONS.unreadablePhone)
    else if (o.whatsapp.trim() !== "" && normalizeAgentPhone(o.whatsapp) === null) problem = refused(STUDENT_REASONS.unreadableWhatsapp)
    else if (o.visitDate.trim() !== "" && n.visitDate === null) problem = refused(STUDENT_REASONS.unreadableDate)
    else if (n.visitDate !== null && n.visitDate > today) problem = refused(STUDENT_REASONS.futureDate)
    else if (codeUnreadable) problem = refused(STUDENT_REASONS.unreadableCode)
    else if (n.status === null) problem = refused(STUDENT_REASONS.unknownStatus)
    else if (students.has(sheetRow)) problem = refused(STUDENT_REASONS.duplicateStudent(students.get(sheetRow)!))
    return { ...row, problem }
  })
}

// ---------------------------------------------------------------------------
// The database's verdicts.
// ---------------------------------------------------------------------------

// Whether the row takes the import date for its Visit date.
function usesImportDate(values: StudentImportValues): boolean {
  return values.visitDate === null && (values.status === "Visited" || values.status === "Interviewed" || values.status === "Enrolled")
}

export function classOfVerdict(
  verdict: StudentVerdict,
  values: StudentImportValues,
): { class: StudentImportClass; reason: string | null; notes: string[] } {
  switch (verdict.verdict) {
    case "present":
      return { class: "present", reason: STUDENT_REASONS.present(verdict.lead.admissionNumber), notes: [] }
    case "refused":
      return { class: "refused", reason: STUDENT_REASONS.refusedByCheck(verdict.field), notes: [] }
    case "create":
    case "joins_family": {
      const notes: string[] = []
      if (verdict.family) notes.push(STUDENT_NOTES.joinsFamily(verdict.family.fullName))
      if (verdict.familyRow !== null) notes.push(STUDENT_NOTES.sameFamily(verdict.familyRow))
      if (verdict.unknownCode) notes.push(STUDENT_NOTES.unknownCode)
      if (usesImportDate(values)) notes.push(STUDENT_NOTES.importDate)
      return { class: verdict.verdict === "create" ? "create" : "joins-family", reason: null, notes }
    }
  }
}

// Every screened row with its class. A row that passed the file's checks
// needs the database's verdict.
export function applyStudentVerdicts(
  rows: readonly ScreenedStudentRow[],
  verdicts: ReadonlyMap<number, StudentVerdict>,
): StudentImportRow[] {
  return rows.map((row) => {
    const base = { sheetRow: row.sheetRow, original: row.original, normalized: row.normalized }
    if (row.problem) return { ...base, class: row.problem.class, reason: row.problem.reason, notes: [], verdict: null }
    const verdict = verdicts.get(row.sheetRow)
    if (!verdict) throw new Error(`No verdict for sheet row ${row.sheetRow}`)
    return { ...base, ...classOfVerdict(verdict, row.normalized), verdict }
  })
}

export type StudentImportSummary = Record<StudentImportClass, number> & { total: number; skipped: number }

export function studentImportSummary(rows: readonly StudentImportRow[]): StudentImportSummary {
  const summary = Object.fromEntries(STUDENT_IMPORT_CLASSES.map((c) => [c, 0])) as Record<StudentImportClass, number>
  for (const row of rows) summary[row.class] += 1
  return { total: rows.length, ...summary, skipped: rows.length - summary.create - summary["joins-family"] }
}

// The rows staff fix and upload again: refused and flagged, as uploaded.
// Rows already on file are left out: uploading them again changes nothing.
export function refusedStudentRowsCsv(rows: readonly StudentImportRow[]): string {
  return refusedRowsCsv(
    STUDENT_IMPORT_COLUMNS,
    rows
      .filter((row) => row.class === "refused" || row.class === "flagged")
      .map((row) => ({ sheetRow: row.sheetRow, cells: row.original, reason: row.reason ?? "" })),
  )
}

// What confirm sends: the file's name and row count, and each row the
// database checked with the verdict staff saw. The original values stay in
// the browser.
export type StudentImportConfirmation = {
  fileName: string
  rowCount: number
  rows: { sheetRow: number; normalized: StudentImportValues; verdict: StudentVerdict }[]
}

export function confirmationOf(check: { fileName: string; rows: readonly StudentImportRow[] }): StudentImportConfirmation {
  return {
    fileName: check.fileName,
    rowCount: check.rows.length,
    rows: check.rows.flatMap((row) => (row.verdict ? [{ sheetRow: row.sheetRow, normalized: row.normalized, verdict: row.verdict }] : [])),
  }
}

// The rows after a confirm found some changed: those reclassified by their
// verdict now and marked, every other row unmarked.
export function withChanges(
  rows: readonly StudentImportRow[],
  changed: readonly { sheetRow: number; verdict: StudentVerdict }[],
): StudentImportRow[] {
  const now = new Map(changed.map((row) => [row.sheetRow, row.verdict]))
  return rows.map((row) => {
    const verdict = now.get(row.sheetRow)
    if (!verdict) return { ...row, changed: false }
    return { ...row, ...classOfVerdict(verdict, row.normalized), verdict, changed: true }
  })
}

// ---------------------------------------------------------------------------
// The database's shapes. The service sends rows and verdicts in these and
// reads verdicts back from them.
// ---------------------------------------------------------------------------

export type DbStudentRow = {
  sheet_row: number
  student_name: string | null
  class_name: string | null
  pre_form_one: boolean
  enrollment_year: number | null
  day_or_boarding: string | null
  guardian_name: string | null
  relationship: string | null
  relationship_description: string | null
  phone: string | null
  whatsapp: string | null
  visit_date: string | null
  referral_code: string | null
  status: string | null
}

export type DbStudentVerdict =
  | {
      verdict: "create" | "joins_family"
      family_row: number | null
      family: { contact_id: string; full_name: string } | null
      unknown_code: boolean
    }
  | { verdict: "present"; lead: { id: string; admission_number: string; status: string } }
  | { verdict: "refused"; field: string }

export function rowToDb(row: { sheetRow: number; normalized: StudentImportValues }): DbStudentRow {
  const v = row.normalized
  return {
    sheet_row: row.sheetRow,
    student_name: v.studentName,
    class_name: v.className,
    pre_form_one: v.preFormOne,
    enrollment_year: v.enrollmentYear,
    day_or_boarding: v.dayOrBoarding,
    guardian_name: v.guardianName,
    relationship: v.relationship,
    relationship_description: v.relationshipDescription,
    phone: v.phone,
    whatsapp: v.whatsapp,
    visit_date: v.visitDate,
    referral_code: v.discountCode,
    status: v.status,
  }
}

export function verdictFromDb(row: DbStudentVerdict): StudentVerdict {
  switch (row.verdict) {
    case "present":
      return { verdict: "present", lead: { id: row.lead.id, admissionNumber: row.lead.admission_number, status: row.lead.status } }
    case "refused":
      return { verdict: "refused", field: row.field }
    default:
      return {
        verdict: row.verdict,
        familyRow: row.family_row,
        family: row.family ? { contactId: row.family.contact_id, fullName: row.family.full_name } : null,
        unknownCode: row.unknown_code,
      }
  }
}

// The verdict as the database wrote it, for confirm to compare: the same
// keys and values, so an unchanged verdict compares equal.
export function verdictToDb(verdict: StudentVerdict): DbStudentVerdict {
  switch (verdict.verdict) {
    case "present":
      return { verdict: "present", lead: { id: verdict.lead.id, admission_number: verdict.lead.admissionNumber, status: verdict.lead.status } }
    case "refused":
      return { verdict: "refused", field: verdict.field }
    default:
      return {
        verdict: verdict.verdict,
        family_row: verdict.familyRow,
        family: verdict.family ? { contact_id: verdict.family.contactId, full_name: verdict.family.fullName } : null,
        unknown_code: verdict.unknownCode,
      }
  }
}
