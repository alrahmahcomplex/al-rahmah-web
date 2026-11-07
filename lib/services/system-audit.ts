import type { SupabaseClient } from "@supabase/supabase-js"

import { tanzaniaToday } from "@/lib/school-calendar"

import type { Result } from "./result"

// The audit history is the Super Admin's alone (#237). This module reads the
// system-wide audit screen and the one fact every other lead reader keeps:
// when a lead's status last changed.

export type AuditArea = "lead" | "payment" | "staff_admin"

export const AUDIT_AREAS: readonly { value: AuditArea; label: string }[] = [
  { value: "lead", label: "Leads" },
  { value: "payment", label: "Payments" },
  { value: "staff_admin", label: "Staff administration" },
]

// Actors that are not a staff member.
export const SYSTEM_ACTORS: readonly { value: string; label: string }[] = [
  { value: "system", label: "System" },
  { value: "public_form", label: "Admission form" },
  { value: "workbook_import", label: "Workbook import" },
]

export type AuditFilters = {
  // YYYY-MM-DD, East Africa Time, inclusive.
  from?: string
  to?: string
  // A staff id, or one of SYSTEM_ACTORS.
  actor?: string
  area?: AuditArea
  // An Admission Number, or a record id.
  record?: string
  page?: number
}

export const AUDIT_PAGE_SIZE = 50

export type AuditEntry = {
  id: number
  at: string
  area: AuditArea
  table: string | null
  recordId: string | null
  leadId: string | null
  admissionNumber: string | null
  action: string
  oldValues: Record<string, unknown> | null
  newValues: Record<string, unknown> | null
  actor: string
}

export type AuditPage = { entries: AuditEntry[]; total: number; page: number; pageCount: number }

export type AuditError = "forbidden" | "invalid" | "unavailable"

type AuditRow = {
  id: number
  created_at: string
  scope: AuditArea
  table_name: string | null
  row_id: string | null
  lead_id: string | null
  admission_number: string | null
  action: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  actor_kind: string
  actor_staff_id: string | null
  actor_name: string | null
  total: number
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const AREAS = new Set<string>(AUDIT_AREAS.map((area) => area.value))

// The filters from the page's query string, dropping anything malformed so a
// hand-edited URL shows everything rather than an error.
export function auditFilters(params: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (key: string) => {
    const value = params[key]
    const text = (Array.isArray(value) ? value[0] : value)?.trim()
    return text ? text : undefined
  }
  const from = one("from")
  const to = one("to")
  const area = one("area")
  const page = Number(one("page") ?? "1")
  return {
    from: from && DAY.test(from) ? from : undefined,
    to: to && DAY.test(to) ? to : undefined,
    actor: one("actor"),
    area: area && AREAS.has(area) ? (area as AuditArea) : undefined,
    record: one("record"),
    page: Number.isInteger(page) && page > 0 ? page : 1,
  }
}

function actorLabel(row: Pick<AuditRow, "actor_kind" | "actor_name">): string {
  if (row.actor_kind === "staff") return row.actor_name ?? "A former staff member"
  return SYSTEM_ACTORS.find((actor) => actor.value === row.actor_kind)?.label ?? row.actor_kind
}

// The page asked for. The total comes with the rows, so a page past the last
// one (an old link, or entries that no longer match) shows the first page
// rather than "Nothing matches".
export async function getAuditPage(supabase: SupabaseClient, filters: AuditFilters): Promise<Result<AuditPage, AuditError>> {
  const read = await readAuditPage(supabase, filters, filters.page ?? 1)
  if (read.ok && read.data.entries.length === 0 && read.data.page > 1) return readAuditPage(supabase, filters, 1)
  return read
}

async function readAuditPage(supabase: SupabaseClient, filters: AuditFilters, page: number): Promise<Result<AuditPage, AuditError>> {
  const { data, error } = await supabase.rpc("audit_entries", {
    from_day: filters.from ?? null,
    to_day: filters.to ?? null,
    actor: filters.actor ?? null,
    area: filters.area ?? null,
    record: filters.record ?? null,
    page_limit: AUDIT_PAGE_SIZE,
    page_offset: (page - 1) * AUDIT_PAGE_SIZE,
  })
  if (error) {
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    if (error.message === "invalid") return { ok: false, error: "invalid" }
    console.error("Could not read the audit history", error)
    return { ok: false, error: "unavailable" }
  }

  const rows = (data ?? []) as AuditRow[]
  const total = rows.length > 0 ? Number(rows[0].total) : 0
  return {
    ok: true,
    data: {
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / AUDIT_PAGE_SIZE)),
      entries: rows.map((row) => ({
        id: row.id,
        at: row.created_at,
        area: row.scope,
        table: row.table_name,
        recordId: row.row_id,
        leadId: row.lead_id,
        admissionNumber: row.admission_number,
        action: row.action,
        oldValues: row.old_values,
        newValues: row.new_values,
        actor: actorLabel(row),
      })),
    },
  }
}

// When the lead's status last changed, as a day in East Africa Time
// (YYYY-MM-DD). Needs leads.view. The date decorates the lead screen, so a
// failure is logged and the screen shows the status alone.
export async function getLeadStatusSince(supabase: SupabaseClient, leadId: string): Promise<Result<string, "unavailable">> {
  const { data, error } = await supabase.rpc("lead_status_since", { lead_id: leadId })
  if (error || typeof data !== "string") {
    // A missing lead is the lead screen's own 404.
    if (error?.message === "not_found" || error?.code === "22P02") return { ok: false, error: "unavailable" }
    console.error("Could not read when a lead's status last changed", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: tanzaniaToday(new Date(data)) }
}

export type AuditActor = { id: string; name: string }

// Every staff member the Super Admin may pick as an actor, deactivated ones
// and the Super Admin included.
export async function getAuditActors(supabase: SupabaseClient): Promise<Result<AuditActor[], "unavailable">> {
  const { data, error } = await supabase.from("staff_members").select("id, full_name").order("full_name")
  if (error) {
    console.error("Could not read the staff for the audit filters", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: ((data ?? []) as { id: string; full_name: string }[]).map((s) => ({ id: s.id, name: s.full_name })) }
}

// One field's change as text: values are JSON as stored, so a column a
// later migration adds still shows under its own name.
export function auditValue(value: unknown): string {
  if (value === null || value === undefined) return "empty"
  return typeof value === "string" ? value : JSON.stringify(value)
}

export type AuditChange = { field: string; from: string | null; to: string }

// The fields an entry changed: on an update, each changed field from its old
// to its new value; otherwise every value it holds.
export function auditChanges(entry: Pick<AuditEntry, "action" | "oldValues" | "newValues">): AuditChange[] {
  const newValues = entry.newValues ?? {}
  const oldValues = entry.oldValues ?? {}
  return Object.keys(newValues).map((field) => ({
    field,
    from: entry.action === "update" ? auditValue(oldValues[field]) : null,
    to: auditValue(newValues[field]),
  }))
}

// The page's query string for these filters on `page`.
export function auditHref(filters: AuditFilters, page: number): string {
  const params = new URLSearchParams()
  for (const key of ["from", "to", "actor", "area", "record"] as const) {
    const value = filters[key]
    if (value) params.set(key, value)
  }
  if (page > 1) params.set("page", String(page))
  const query = params.toString()
  return query ? `/staff/audit?${query}` : "/staff/audit"
}
