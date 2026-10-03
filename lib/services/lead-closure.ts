import type { SupabaseClient } from "@supabase/supabase-js"

import type { Permission } from "@/lib/permissions"

import type { LeadStatus } from "./leads"
import type { Result } from "./result"

// The lead closure module (slice 8, #27): declining a lead, and reading why a
// lead is closed. Every write is a database function that checks the
// permission itself and refuses a closed lead, so these calls only translate
// what the database answers. #98 and #99 add closure marks and reopening
// requests here.

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

export type LeadClosure = {
  // Set while the lead is Declined.
  decline: LeadDecline | null
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
}

// The lead's current decline, for staff who may view leads.
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

  const { decline } = data as ClosureRow
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
    },
  }
}
