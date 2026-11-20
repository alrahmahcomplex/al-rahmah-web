import type { LeadHistoryEntry } from "@/lib/services/audit"

import { causeText } from "./enrolment-history"

// Why a sibling group, a Sibling discount or a seat changed: the "Because"
// line of their history entries (#428). The payments' recompute causes read
// as they do on an Enrolled entry; these are the rest.

export type BecauseOf = "group" | "result" | "seat"

const CAUSES: Readonly<Record<string, string>> = {
  lead_created: "The application was created",
  enrolled: "The student was Enrolled",
  grants_resumed: "New Sibling 10% grants were switched back on",
  sibling_link: "Staff chose Sibling of",
  merge: "Two sibling groups were joined",
  father_name: "The father’s full name was corrected",
  sibling_request: "A Sibling request was decided",
  left_legacy: "The applicant stopped being a Legacy member",
  registration: "The student was registered at the desk",
  visit_completion: "Check-in completed the Admission form details",
  seat_freed: "A seat came free",
  stream_opened: "A new stream was opened",
  declined: "The application was declined",
  gender: "Boy or girl was corrected",
}

const RECORDS: Readonly<Record<string, BecauseOf>> = {
  sibling_group_members: "group",
  lead_sibling_results: "result",
  seat_placements: "seat",
}

// The "Because" line says why this change happened, so it shows only the new
// cause, never the one before.
export function isBecause(record: string | null, field: string): boolean {
  return field === "cause" && (record ?? "") in RECORDS
}

// Each row's cause after each of its entries, by entry id. Every write sets
// the cause, and an update records only what changed, so a cause the same as
// the one before is carried forward from the row's earlier entries.
export type RowCauses = ReadonlyMap<number, unknown>

export function rowCauses(entries: readonly LeadHistoryEntry[]): RowCauses {
  const latest = new Map<string, unknown>()
  const causes = new Map<number, unknown>()
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (!((entry.record ?? "") in RECORDS) || !entry.recordId) continue
    const written = entry.changes.find((c) => c.field === "cause")
    if (written) latest.set(entry.recordId, written.to)
    if (latest.has(entry.recordId)) causes.set(entry.id, latest.get(entry.recordId))
  }
  return causes
}

// An update that kept its row's cause still says it.
export function withCause(entry: LeadHistoryEntry, causes: RowCauses): LeadHistoryEntry {
  if (entry.action !== "update" || !causes.has(entry.id) || entry.changes.some((c) => c.field === "cause")) return entry
  return { ...entry, changes: [...entry.changes, { field: "cause", from: null, to: causes.get(entry.id) }] }
}

// The cause in words, or null for one no screen knows yet, which shows as stored.
export function becauseText(of: BecauseOf, cause: unknown): string | null {
  if (typeof cause !== "string") return null
  if (cause === "migration") return of === "seat" ? "The school moved to streams" : "Sibling groups began"
  if (CAUSES[cause]) return CAUSES[cause]
  const recompute = causeText(cause)
  return recompute && recompute !== cause ? recompute.charAt(0).toUpperCase() + recompute.slice(1) : null
}
