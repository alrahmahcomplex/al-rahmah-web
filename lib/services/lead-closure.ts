import type { SupabaseClient } from "@supabase/supabase-js"

import type { Permission } from "@/lib/permissions"

import type { LeadClosure as ClosureMark, LeadStatus } from "./leads"
import type { Result } from "./result"

// The lead closure module (slice 8, #27): declining a lead, marking it
// Inactive or Archived, and reading why a lead is closed. Every write is a
// database function that checks the permission and the rules itself, so
// these calls only translate what the database answers. Reopening requests,
// their approval and rejection included, live in reopening-requests.ts.

export { approveReopeningRequest, rejectReopeningRequest } from "./reopening-requests"

// The fixed list, in the order staff pick from.
export const DECLINED_REASONS = [
  "Enrolled elsewhere",
  "Family changed plans",
  "Fees or cost",
  "Fee payment not completed",
  "No seat available",
  "Did not pass interview",
  "Unreachable after follow-up",
  "School decision",
  "Other",
] as const
export type DeclinedReason = (typeof DECLINED_REASONS)[number]

// Releasing a seat: only staff who may set the seats may use it.
export const SEAT_RELEASE_REASON = "No seat available" satisfies DeclinedReason

// The longest explanation the database keeps.
export const DECLINE_EXPLANATION_MAX = 1000

// The reasons a staff member may pick, given their permissions.
export function declinedReasonsFor(permissions: readonly Permission[]): DeclinedReason[] {
  return DECLINED_REASONS.filter((reason) => reason !== SEAT_RELEASE_REASON || permissions.includes("academic_years.manage"))
}

export function isDeclinedReason(value: unknown): value is DeclinedReason {
  return typeof value === "string" && (DECLINED_REASONS as readonly string[]).includes(value)
}

// ---------------------------------------------------------------------------
// Declining a lead.
// ---------------------------------------------------------------------------

export type DeclineInput = {
  reason: DeclinedReason
  // Optional, but required for Other. Blank counts as none.
  explanation?: string
}

export type DeclineError =
  // No leads.decline, or No seat available without academic_years.manage.
  | "forbidden"
  // No reason from the list, Other without an explanation, or one too long.
  | "invalid"
  // Already Declined, or Inactive or Archived: read-only.
  | "lead-closed"
  | "not-found"
  | "unavailable"

// Marks an open lead Declined, remembering the status it held. Needs
// leads.decline, and academic_years.manage for No seat available.
export async function declineLead(
  supabase: SupabaseClient,
  leadId: string,
  { reason, explanation }: DeclineInput,
): Promise<Result<null, DeclineError>> {
  const { error } = await supabase.rpc("decline_lead", {
    lead_id: leadId,
    reason,
    explanation: explanation ?? null,
  })
  if (!error) return { ok: true, data: null }

  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
  // A malformed id is a missing lead, not an outage.
  if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
  if (error.message === "lead_closed") return { ok: false, error: "lead-closed" }
  if (error.message === "invalid") return { ok: false, error: "invalid" }
  console.error("Could not decline a lead", error)
  return { ok: false, error: "unavailable" }
}

// ---------------------------------------------------------------------------
// Marking a lead Inactive or Archived.
// ---------------------------------------------------------------------------

// The fixed list, in the order staff pick from.
export const CLOSURE_REASONS = [
  "Duplicate record",
  "Family requested closure",
  "Enrolled elsewhere",
  "No longer pursuing admission",
  "Record created in error",
  "Admission cycle ended",
] as const
export type ClosureReason = (typeof CLOSURE_REASONS)[number]

export function isClosureReason(value: unknown): value is ClosureReason {
  return typeof value === "string" && (CLOSURE_REASONS as readonly string[]).includes(value)
}

// The longest note the database keeps.
export const CLOSURE_NOTE_MAX = 1000

export type MarkMove = "inactive" | "archived"

// The closure mark each move sets.
export const MARK_OF: Readonly<Record<MarkMove, ClosureMark>> = { inactive: "Inactive", archived: "Archived" }

export function isMarkMove(value: unknown): value is MarkMove {
  return value === "inactive" || value === "archived"
}

// The marks a lead may still take, whatever its status: both while it has
// none, Archived alone once it is Inactive, and none once it is Archived. Only
// an approved reopening removes a mark.
export function marksAllowed(closure: ClosureMark | null): MarkMove[] {
  if (closure === null) return ["inactive", "archived"]
  return closure === "Inactive" ? ["archived"] : []
}

export type MarkInput = {
  mark: MarkMove
  reason: ClosureReason
  // Optional. Blank counts as none.
  note?: string
}

export type MarkError =
  // No leads.close.
  | "forbidden"
  // No reason from the list, a note too long, or a move the rules don't
  // allow: any mark on an Archived lead, or Inactive on an Inactive one.
  | "invalid"
  | "not-found"
  | "unavailable"

// Puts a closure mark on a lead, keeping its status. Needs leads.close.
export async function markLead(
  supabase: SupabaseClient,
  leadId: string,
  { mark, reason, note }: MarkInput,
): Promise<Result<null, MarkError>> {
  // A mark that isn't one of the two moves is sent as it came, and refused.
  const { error } = await supabase.rpc("mark_lead", {
    lead_id: leadId,
    mark: isMarkMove(mark) ? MARK_OF[mark] : String(mark),
    reason,
    note: note ?? null,
  })
  if (!error) return { ok: true, data: null }

  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
  if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
  if (error.message === "invalid") return { ok: false, error: "invalid" }
  console.error("Could not mark a lead", error)
  return { ok: false, error: "unavailable" }
}

// ---------------------------------------------------------------------------
// Why a lead is closed.
// ---------------------------------------------------------------------------

export type LeadDecline = {
  reason: DeclinedReason
  explanation: string | null
  // Empty only on leads declined before declines were recorded.
  declinedAt: string | null
  // The staff member's name, looked up now.
  declinedBy: string | null
  statusBefore: LeadStatus | null
}

export type LeadClosureMark = {
  mark: ClosureMark
  reason: ClosureReason
  note: string | null
  // Empty only on leads marked before marks were recorded.
  closedAt: string | null
  // The staff member's name, looked up now.
  closedBy: string | null
}

// The latest approval that reopened the lead from Declined.
export type ReopenedAfterDecline = {
  reopenedAt: string
  // The approver's name, looked up now.
  approvedBy: string
  restoredStatus: LeadStatus
  // Null when the lead was declined before its interview.
  enrolWithoutRetake: boolean | null
}

export type LeadClosure = {
  // Set while the lead is Declined.
  decline: LeadDecline | null
  // Set while the lead carries a closure mark.
  closure: LeadClosureMark | null
  // Kept for good once an approval reopens the lead from Declined.
  initiallyDeclined: boolean
  // The Reopened after decline note; null for a lead never reopened from
  // Declined.
  reopenedAfterDecline: ReopenedAfterDecline | null
}

export type LeadClosureError = "forbidden" | "not-found" | "unavailable"

type ClosureRow = {
  decline: {
    reason: DeclinedReason
    explanation: string | null
    declined_at: string | null
    declined_by: string | null
    status_before: LeadStatus | null
  } | null
  closure: {
    mark: ClosureMark
    reason: ClosureReason
    note: string | null
    closed_at: string | null
    closed_by: string | null
  } | null
  initially_declined: boolean
  reopened_after_decline: {
    reopened_at: string
    approved_by: string
    restored_status: LeadStatus
    enrol_without_retake: boolean | null
  } | null
}

// The lead's current decline and closure mark, for staff who may view leads.
export async function getLeadClosure(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadClosure, LeadClosureError>> {
  const { data, error } = await supabase.rpc("lead_closure", { lead_id: leadId })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not read why a lead is closed", error)
    return { ok: false, error: "unavailable" }
  }

  const { decline, closure, initially_declined, reopened_after_decline: reopened } = data as ClosureRow
  return {
    ok: true,
    data: {
      decline: decline && {
        reason: decline.reason,
        explanation: decline.explanation,
        declinedAt: decline.declined_at,
        declinedBy: decline.declined_by,
        statusBefore: decline.status_before,
      },
      closure: closure && {
        mark: closure.mark,
        reason: closure.reason,
        note: closure.note,
        closedAt: closure.closed_at,
        closedBy: closure.closed_by,
      },
      initiallyDeclined: initially_declined,
      reopenedAfterDecline: reopened && {
        reopenedAt: reopened.reopened_at,
        approvedBy: reopened.approved_by,
        restoredStatus: reopened.restored_status,
        enrolWithoutRetake: reopened.enrol_without_retake,
      },
    },
  }
}
