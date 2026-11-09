import { findDuplicates, refusedRowsCsv, toCsv, type ImportColumn, type ImportRecord } from "@/lib/import"

// The agent import's rules on top of the import module (#190): the
// template's columns, normalising each value as the database stores it, the
// checks a file fails on its own, and the classes the check screen shows.
// Checks against agents already stored are the database's: it gives each
// remaining row a verdict, and confirm re-checks those verdicts under its
// lock. Runs in the browser and on the server; reads no table.

export type AgentImportKey = "code" | "fullName" | "mobile" | "whatsapp" | "email"

export const AGENT_IMPORT_COLUMNS: readonly ImportColumn<AgentImportKey>[] = [
  { key: "code", header: "Code", aliases: ["discount code", "referral code"] },
  { key: "fullName", header: "Full name", aliases: ["name"] },
  { key: "mobile", header: "Mobile", aliases: ["phone", "mobile number", "phone number"] },
  { key: "whatsapp", header: "WhatsApp", aliases: ["whatsapp number"] },
  { key: "email", header: "Email", aliases: ["e-mail", "email address"] },
]

// The template the Manager downloads: the header row only.
export const AGENT_IMPORT_TEMPLATE = toCsv([AGENT_IMPORT_COLUMNS.map((column) => column.header)])

export type AgentImportValues = {
  code: string | null
  fullName: string | null
  mobile: string | null
  whatsapp: string | null
  email: string | null
}

// The classes of the check screen. Only create and email-to-add change
// anything; every other row is skipped.
export const AGENT_IMPORT_CLASSES = ["create", "present", "email-to-add", "email-differs", "mobile-differs", "flagged", "refused"] as const
export type AgentImportClass = (typeof AGENT_IMPORT_CLASSES)[number]

// A stored agent the database's verdict names.
export type ImportAgentRef = { id: string; fullName: string; code: string; phone: string; email: string | null }

// The database's verdict on a row that passed the file's own checks.
export type AgentVerdict =
  | { verdict: "create" }
  | { verdict: "present" | "email_to_add" | "email_differs" | "mobile_differs" | "code_exists" | "mobile_taken"; agent: ImportAgentRef }
  // promo_code: a Promo code holds the code, and codes are one namespace.
  | { verdict: "retired_code" | "email_taken" | "promo_code" }

export type ScreenedAgentRow = {
  sheetRow: number
  original: Record<AgentImportKey, string>
  normalized: AgentImportValues
  // Null when the row goes on to the database's check.
  problem: { class: "flagged" | "refused"; reason: string } | null
}

export type AgentImportRow = {
  sheetRow: number
  original: Record<AgentImportKey, string>
  normalized: AgentImportValues
  class: AgentImportClass
  // Why a row is skipped, when its class doesn't say it all.
  reason: string | null
  // The stored agent the row matches or conflicts with.
  agent: ImportAgentRef | null
  // What the database said, for confirm to re-check; null for a row the
  // file's own checks stopped.
  verdict: AgentVerdict | null
  // Set when confirm found the row no longer as checked.
  changed?: boolean
}

// ---------------------------------------------------------------------------
// Normalising. These follow normalize_referral_code, normalize_phone and
// agent_draft in the database, which re-checks every value it is sent.
// ---------------------------------------------------------------------------

export function normalizeAgentCode(raw: string): string | null {
  if (!/^[A-Za-z0-9.\-\s]*$/.test(raw)) return null
  const code = raw.replace(/\s/g, "").toUpperCase()
  return /^[A-Z0-9.-]{1,20}$/.test(code) ? code : null
}

export function normalizeAgentPhone(raw: string): string | null {
  const s = raw.replace(/[\s.()[\]-]/g, "")
  if (/^0\d{9}$/.test(s)) return `+255${s.slice(1)}`
  if (/^\d{9}$/.test(s)) return `+255${s}`
  if (/^255\d{9}$/.test(s)) return `+${s}`
  if (/^\+255\d{9}$/.test(s)) return s
  if (/^\+255/.test(s)) return null
  if (/^\+\d{8,15}$/.test(s)) return s
  return null
}

const normalizeName = (raw: string) => raw.replace(/\s+/g, " ").trim()

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.length <= 254 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null
}

// A number Excel has turned into a figure: all digits with a decimal point
// (`712000012.0`, `123.0`) or in scientific notation, which drops digits.
// Codes with letters, like `AJM.12`, and plain digits are left alone.
function looksLikeExcelNumber(raw: string): boolean {
  return /^[+-]?(\d+\.\d+|\d+(\.\d+)?[eE][+-]?\d+)$/.test(raw.trim())
}

// ---------------------------------------------------------------------------
// The file's own checks.
// ---------------------------------------------------------------------------

export const AGENT_REASONS = {
  flagged: "Looks like an Excel number",
  missingName: "Missing name",
  nameTooLong: "Name too long",
  badCode: "Bad code",
  mobileMissing: "Mobile missing",
  unreadableMobile: "Unreadable mobile",
  unreadableWhatsapp: "Unreadable WhatsApp",
  unreadableEmail: "Unreadable email",
  duplicateCode: (rows: number[]) => `Duplicate code in file (rows ${rows.join(", ")})`,
  duplicateMobile: "Duplicate mobile in file",
  duplicateEmail: "Duplicate email in file",
  codeExists: (name: string) => `Code exists as ${name}`,
  retiredCode: "Code belongs to a retired record (use Recreate)",
  promoCode: "Code is a Promo code",
  mobileTaken: (name: string, code: string) => `Mobile already belongs to ${name}, ${code}`,
  emailTaken: "Email already in use",
  emailDiffers: "Email differs (not changed)",
  mobileDiffers: "Mobile differs (not changed)",
} as const

export function screenAgentRows(records: readonly ImportRecord<AgentImportKey>[]): ScreenedAgentRow[] {
  const rows = records.map((record) => {
    const { cells } = record
    const fullName = normalizeName(cells.fullName)
    const mobile = normalizeAgentPhone(cells.mobile)
    let whatsapp = cells.whatsapp.trim() === "" ? null : normalizeAgentPhone(cells.whatsapp)
    if (whatsapp !== null && whatsapp === mobile) whatsapp = null
    const normalized: AgentImportValues = {
      code: normalizeAgentCode(cells.code),
      fullName: fullName === "" ? null : fullName,
      mobile,
      whatsapp,
      email: cells.email.trim() === "" ? null : normalizeEmail(cells.email),
    }
    return { sheetRow: record.sheetRow, original: { ...cells }, normalized }
  })

  const codes = findDuplicates(rows.map((row) => ({ sheetRow: row.sheetRow, key: row.normalized.code })))
  const mobiles = findDuplicates(rows.map((row) => ({ sheetRow: row.sheetRow, key: row.normalized.mobile })))
  const emails = findDuplicates(rows.map((row) => ({ sheetRow: row.sheetRow, key: row.normalized.email })))

  return rows.map((row) => {
    const { original: o, normalized: n, sheetRow } = row
    const refused = (reason: string) => ({ class: "refused" as const, reason })
    let problem: ScreenedAgentRow["problem"] = null
    if (looksLikeExcelNumber(o.code) || looksLikeExcelNumber(o.mobile) || looksLikeExcelNumber(o.whatsapp)) {
      problem = { class: "flagged", reason: AGENT_REASONS.flagged }
    } else if (n.fullName === null || n.fullName.length < 2) problem = refused(AGENT_REASONS.missingName)
    else if (n.fullName.length > 100) problem = refused(AGENT_REASONS.nameTooLong)
    else if (n.code === null) problem = refused(AGENT_REASONS.badCode)
    else if (o.mobile.trim() === "") problem = refused(AGENT_REASONS.mobileMissing)
    else if (n.mobile === null) problem = refused(AGENT_REASONS.unreadableMobile)
    else if (o.whatsapp.trim() !== "" && normalizeAgentPhone(o.whatsapp) === null) problem = refused(AGENT_REASONS.unreadableWhatsapp)
    else if (o.email.trim() !== "" && n.email === null) problem = refused(AGENT_REASONS.unreadableEmail)
    else if (codes.has(sheetRow)) problem = refused(AGENT_REASONS.duplicateCode(codes.get(sheetRow)!))
    else if (mobiles.has(sheetRow)) problem = refused(AGENT_REASONS.duplicateMobile)
    else if (emails.has(sheetRow)) problem = refused(AGENT_REASONS.duplicateEmail)
    return { ...row, problem }
  })
}

// ---------------------------------------------------------------------------
// The database's verdicts.
// ---------------------------------------------------------------------------

export function classOfVerdict(verdict: AgentVerdict): { class: AgentImportClass; reason: string | null; agent: ImportAgentRef | null } {
  switch (verdict.verdict) {
    case "create":
      return { class: "create", reason: null, agent: null }
    case "present":
      return { class: "present", reason: null, agent: verdict.agent }
    case "email_to_add":
      return { class: "email-to-add", reason: null, agent: verdict.agent }
    case "email_differs":
      return { class: "email-differs", reason: AGENT_REASONS.emailDiffers, agent: verdict.agent }
    case "mobile_differs":
      return { class: "mobile-differs", reason: AGENT_REASONS.mobileDiffers, agent: verdict.agent }
    case "code_exists":
      return { class: "refused", reason: AGENT_REASONS.codeExists(verdict.agent.fullName), agent: verdict.agent }
    case "mobile_taken":
      return { class: "refused", reason: AGENT_REASONS.mobileTaken(verdict.agent.fullName, verdict.agent.code), agent: verdict.agent }
    case "retired_code":
      return { class: "refused", reason: AGENT_REASONS.retiredCode, agent: null }
    case "promo_code":
      return { class: "refused", reason: AGENT_REASONS.promoCode, agent: null }
    case "email_taken":
      return { class: "refused", reason: AGENT_REASONS.emailTaken, agent: null }
  }
}

// Every screened row with its class. A row that passed the file's checks
// needs the database's verdict.
export function applyAgentVerdicts(rows: readonly ScreenedAgentRow[], verdicts: ReadonlyMap<number, AgentVerdict>): AgentImportRow[] {
  return rows.map((row) => {
    const base = { sheetRow: row.sheetRow, original: row.original, normalized: row.normalized }
    if (row.problem) return { ...base, class: row.problem.class, reason: row.problem.reason, agent: null, verdict: null }
    const verdict = verdicts.get(row.sheetRow)
    if (!verdict) throw new Error(`No verdict for sheet row ${row.sheetRow}`)
    return { ...base, ...classOfVerdict(verdict), verdict }
  })
}

export type AgentImportSummary = Record<AgentImportClass, number> & { total: number; skipped: number }

export function agentImportSummary(rows: readonly AgentImportRow[]): AgentImportSummary {
  const summary = Object.fromEntries(AGENT_IMPORT_CLASSES.map((c) => [c, 0])) as Record<AgentImportClass, number>
  for (const row of rows) summary[row.class] += 1
  return { total: rows.length, ...summary, skipped: rows.length - summary.create - summary["email-to-add"] }
}

const plural = (n: number, one: string, many: string) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`

// "Create 42 agents, skip 3 rows".
export function confirmLabel(summary: AgentImportSummary): string {
  const parts: string[] = []
  if (summary.create > 0) parts.push(`create ${plural(summary.create, "agent", "agents")}`)
  if (summary["email-to-add"] > 0) parts.push(`add ${plural(summary["email-to-add"], "email", "emails")}`)
  if (summary.skipped > 0 && parts.length > 0) parts.push(`skip ${plural(summary.skipped, "row", "rows")}`)
  const text = parts.join(", ")
  return text.charAt(0).toUpperCase() + text.slice(1)
}

// The rows the Manager fixes and uploads again: refused and flagged, as
// uploaded. Rows already stored, or that differ from what is stored, are
// left out: uploading them again changes nothing.
export function refusedAgentRowsCsv(rows: readonly AgentImportRow[]): string {
  return refusedRowsCsv(
    AGENT_IMPORT_COLUMNS,
    rows
      .filter((row) => row.class === "refused" || row.class === "flagged")
      .map((row) => ({ sheetRow: row.sheetRow, cells: row.original, reason: row.reason ?? "" })),
  )
}

// What confirm sends: the file's name and row count, and each row the
// database checked with the verdict the Manager saw. The original values
// stay in the browser.
export type AgentImportConfirmation = {
  fileName: string
  rowCount: number
  rows: { sheetRow: number; normalized: AgentImportValues; verdict: AgentVerdict }[]
}

export function confirmationOf(check: { fileName: string; rows: readonly AgentImportRow[] }): AgentImportConfirmation {
  return {
    fileName: check.fileName,
    rowCount: check.rows.length,
    rows: check.rows.flatMap((row) => (row.verdict ? [{ sheetRow: row.sheetRow, normalized: row.normalized, verdict: row.verdict }] : [])),
  }
}

// The rows after a confirm found some changed: those reclassified by their
// verdict now and marked, every other row unmarked.
export function withChanges(rows: readonly AgentImportRow[], changed: readonly { sheetRow: number; verdict: AgentVerdict }[]): AgentImportRow[] {
  const now = new Map(changed.map((row) => [row.sheetRow, row.verdict]))
  return rows.map((row) => {
    const verdict = now.get(row.sheetRow)
    if (!verdict) return { ...row, changed: false }
    return { ...row, ...classOfVerdict(verdict), verdict, changed: true }
  })
}
