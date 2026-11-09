import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { toCsv } from "@/lib/import"

import type { ClosureFilter, LeadClass, LeadSearch, LeadStatus } from "./leads"
import type { Result } from "./result"

// Exporting students as a CSV. export_leads in the database decides who may
// have which columns, applies the Leads screen's filters, caps the rows and
// records the export in export_log (audited, so the Super Admin sees it in
// Audit), all in one call. This module names the columns and presets, turns
// the rows into a CSV, and maps refusals.
//
// Tiers: `view` needs leads.view; `contact` needs leads.export; `full` is the
// Super Admin's only, decided by is_super_admin() in the database.

export type ExportTier = "view" | "contact" | "full"

export const EXPORT_COLUMNS = [
  { key: "admission_number", header: "Admission Number", tier: "view" },
  { key: "student_name", header: "Student name", tier: "view" },
  { key: "class_name", header: "Class", tier: "view" },
  { key: "enrollment_year", header: "Enrollment year", tier: "view" },
  { key: "day_or_boarding", header: "Day or boarding", tier: "view" },
  { key: "status", header: "Status", tier: "view" },
  { key: "status_since", header: "Status since", tier: "view" },
  { key: "visit_date", header: "Visit date", tier: "view" },
  { key: "discount_code", header: "Discount code", tier: "view" },
  { key: "discount_holder", header: "Agent or Promo name", tier: "view" },
  { key: "pre_form_one", header: "Pre-Form One", tier: "view" },
  { key: "imported", header: "Imported", tier: "view" },
  { key: "guardian_name", header: "Parent name", tier: "contact" },
  { key: "relationship", header: "Relationship", tier: "contact" },
  { key: "guardian_phone", header: "Parent phone", tier: "contact" },
  { key: "guardian_whatsapp", header: "WhatsApp", tier: "contact" },
  { key: "interview_fee_status", header: "Interview fee status", tier: "full" },
  { key: "interview_fee_amount", header: "Interview fee (TZS)", tier: "full" },
  { key: "interview_result", header: "Interview result", tier: "full" },
  { key: "interview_score", header: "Interview score", tier: "full" },
  { key: "school_fee", header: "School fee (TZS)", tier: "full" },
  { key: "school_fee_paid", header: "School fee paid (TZS)", tier: "full" },
  { key: "school_fee_discount", header: "School fee discount", tier: "full" },
  { key: "follow_up_notes", header: "Follow-up notes", tier: "full" },
  { key: "declined_reason", header: "Declined reason", tier: "full" },
  { key: "declined_explanation", header: "Declined explanation", tier: "full" },
  { key: "closure", header: "Closure", tier: "full" },
  { key: "history_count", header: "History entries", tier: "full" },
] as const satisfies readonly { key: string; header: string; tier: ExportTier }[]

export type ExportColumn = (typeof EXPORT_COLUMNS)[number]["key"]

const COLUMN_BY_KEY = new Map<string, (typeof EXPORT_COLUMNS)[number]>(EXPORT_COLUMNS.map((column) => [column.key, column]))

export function isExportColumn(key: string): key is ExportColumn {
  return COLUMN_BY_KEY.has(key)
}

export function tierOf(column: ExportColumn): ExportTier {
  return COLUMN_BY_KEY.get(column)!.tier
}

// The checkboxes of "Choose columns", as the prototype groups them: each
// choice adds one or more columns.
export const EXPORT_CHOICES = [
  { key: "adm", label: "Admission Number", tier: "view", columns: ["admission_number"] },
  { key: "name", label: "Student name", tier: "view", columns: ["student_name"] },
  { key: "cls", label: "Class", tier: "view", columns: ["class_name"] },
  { key: "year", label: "Enrollment year", tier: "view", columns: ["enrollment_year"] },
  { key: "db", label: "Day or boarding", tier: "view", columns: ["day_or_boarding"] },
  { key: "status", label: "Status", tier: "view", columns: ["status"] },
  { key: "since", label: "Status since", tier: "view", columns: ["status_since"] },
  { key: "visit", label: "Visit date", tier: "view", columns: ["visit_date"] },
  { key: "code", label: "Discount code", tier: "view", columns: ["discount_code"] },
  { key: "who", label: "Agent or Promo name", tier: "view", columns: ["discount_holder"] },
  { key: "pname", label: "Parent name", tier: "contact", columns: ["guardian_name"] },
  { key: "rel", label: "Relationship", tier: "contact", columns: ["relationship"] },
  { key: "phone", label: "Parent phone", tier: "contact", columns: ["guardian_phone"] },
  { key: "wa", label: "WhatsApp", tier: "contact", columns: ["guardian_whatsapp"] },
  { key: "ifee", label: "Interview fee and payment", tier: "full", columns: ["interview_fee_status", "interview_fee_amount"] },
  { key: "ires", label: "Interview result and score", tier: "full", columns: ["interview_result", "interview_score"] },
  { key: "sfee", label: "School fees and payments", tier: "full", columns: ["school_fee", "school_fee_paid", "school_fee_discount"] },
  { key: "fu", label: "Follow-up notes", tier: "full", columns: ["follow_up_notes"] },
  { key: "hist", label: "History, every change", tier: "full", columns: ["history_count"] },
  { key: "decl", label: "Declined reason", tier: "full", columns: ["declined_reason", "declined_explanation"] },
] as const satisfies readonly { key: string; label: string; tier: ExportTier; columns: readonly ExportColumn[] }[]

export type ExportChoice = (typeof EXPORT_CHOICES)[number]["key"]

// The columns for the chosen checkboxes, in the order the columns are listed.
export function columnsForChoices(choices: readonly string[]): ExportColumn[] {
  const picked = new Set<ExportColumn>(EXPORT_CHOICES.filter((choice) => choices.includes(choice.key)).flatMap((choice) => choice.columns))
  return EXPORT_COLUMNS.map((column) => column.key).filter((key) => picked.has(key))
}

export const EXPORT_PRESETS = [
  { key: "class", label: "Class list", columns: ["admission_number", "student_name", "class_name", "enrollment_year", "day_or_boarding", "status"] },
  {
    key: "calls",
    label: "Follow-up calls",
    columns: ["admission_number", "student_name", "class_name", "status", "status_since", "guardian_name", "guardian_phone", "guardian_whatsapp"],
  },
  { key: "codes", label: "Discount codes", columns: ["admission_number", "student_name", "class_name", "discount_code", "discount_holder", "status"] },
  { key: "full", label: "Full data", columns: EXPORT_COLUMNS.map((column) => column.key) },
  { key: "custom", label: "Choose columns", columns: [] },
] as const satisfies readonly { key: string; label: string; columns: readonly ExportColumn[] }[]

export type ExportPreset = (typeof EXPORT_PRESETS)[number]["key"]

export function isExportPreset(key: string): key is ExportPreset {
  return EXPORT_PRESETS.some((preset) => preset.key === key)
}

// The highest tier among the columns: what the export needs.
export function tierNeeded(columns: readonly ExportColumn[]): ExportTier {
  const tiers = new Set(columns.map(tierOf))
  return tiers.has("full") ? "full" : tiers.has("contact") ? "contact" : "view"
}

// Whether a staff member holding `permissions` (and the Super Admin flag)
// may have the tier. The database decides; this only hides what it refuses.
export function holdsTier(tier: ExportTier, access: { permissions: readonly string[]; superAdmin: boolean }): boolean {
  if (tier === "full") return access.superAdmin
  if (tier === "contact") return access.permissions.includes("leads.export")
  return access.permissions.includes("leads.view")
}

// The database's cap on one export.
export const EXPORT_ROW_CAP = 5000

// Which students: the Leads screen's filters, plus a class, a year or one
// import's leads.
export type ExportFilters = {
  query?: string
  status?: LeadStatus
  closure?: ClosureFilter
  earlierLinkYear?: number
  className?: LeadClass
  enrollmentYear?: number
  importBatchId?: string
}

// The screen's search as export filters, so "the list as filtered now"
// exports what the screen shows.
export function filtersFromSearch(search: Omit<LeadSearch, "page">): ExportFilters {
  return { query: search.query, status: search.status, closure: search.closure, earlierLinkYear: search.earlierLinkYear }
}

function filtersToDb(filters: ExportFilters) {
  const out: Record<string, string | number> = {}
  if (filters.query?.trim()) out.query = filters.query.trim()
  if (filters.status) out.status = filters.status
  if (filters.closure) out.closure = filters.closure
  if (filters.earlierLinkYear !== undefined) out.earlier_link_year = filters.earlierLinkYear
  if (filters.className) out.class_name = filters.className
  if (filters.enrollmentYear !== undefined) out.enrollment_year = filters.enrollmentYear
  if (filters.importBatchId) out.import_batch_id = filters.importBatchId
  return out
}

export type StudentExport = {
  columns: ExportColumn[]
  // One array of cells per student, in the screen's order and the columns'
  // order, every value already text.
  rows: string[][]
  rowCount: number
}

export type StudentExportError =
  | { kind: "forbidden" }
  // An unknown or repeated column, or a filter the database can't read.
  | { kind: "invalid" }
  // More than EXPORT_ROW_CAP students match.
  | { kind: "too-many"; rowCount: number | null }
  | { kind: "unavailable" }

// A value as the CSV writes it: yes or no, a date as yyyy-mm-dd at the
// school, numbers and text as they are, nothing for null.
export function cellText(column: ExportColumn, value: unknown): string {
  if (value === null || value === undefined) return ""
  if (typeof value === "boolean") return value ? "yes" : "no"
  if (column === "status_since" && typeof value === "string") {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(date)
  }
  return String(value)
}

// Exports the students the filters find, with the columns asked. Records the
// export. Refused when any column's tier isn't held.
export async function exportStudents(
  supabase: SupabaseClient,
  filters: ExportFilters,
  columns: readonly ExportColumn[],
): Promise<Result<StudentExport, StudentExportError>> {
  if (columns.length === 0 || columns.some((column) => !isExportColumn(column)) || new Set(columns).size !== columns.length) {
    return { ok: false, error: { kind: "invalid" } }
  }
  const { data, error } = await supabase.rpc("export_leads", { filters: filtersToDb(filters), columns })
  if (error) {
    // 42501: the function isn't granted to the caller at all, as for someone signed out.
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
    if (error.message === "invalid") return { ok: false, error: { kind: "invalid" } }
    if (error.message === "too_many") {
      let rowCount: number | null = null
      try {
        rowCount = (JSON.parse(error.details ?? "") as { row_count?: number }).row_count ?? null
      } catch {
        rowCount = null
      }
      return { ok: false, error: { kind: "too-many", rowCount } }
    }
    console.error("Could not export students", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const answer = data as { rows: Record<string, unknown>[]; row_count: number }
  return {
    ok: true,
    data: {
      columns: [...columns],
      rows: answer.rows.map((row) => columns.map((column) => cellText(column, row[column]))),
      rowCount: answer.row_count,
    },
  }
}

// The CSV file's text: the headers, then each student. Cells that start like
// a formula are guarded, as every import and export file is.
export function studentsCsv(result: Pick<StudentExport, "columns" | "rows">): string {
  return toCsv([result.columns.map((column) => COLUMN_BY_KEY.get(column)!.header), ...result.rows])
}

// students-<preset>-<yyyy-mm-dd>.csv, dated at the school.
export function exportFileName(preset: ExportPreset, now: Date = new Date()): string {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam" }).format(now)
  return `students-${preset}-${day}.csv`
}
