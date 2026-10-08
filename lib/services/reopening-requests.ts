import type { SupabaseClient } from "@supabase/supabase-js"

import type { LeadStatus } from "./leads"
import type { Result } from "./result"

// Reopening requests (slice 8, #27): part of the lead closure module, kept in
// its own file. Staff raise a request on a Declined, Inactive or Archived
// lead, the requester may withdraw it while it is Pending, and an approver
// approves or rejects it (#101). Every write is a database function that checks the
// permission and the rules itself, so these calls only translate what the
// database answers.

export const REOPENING_SOURCES = ["duplicate_match", "lead", "re_application"] as const
export type ReopeningSource = (typeof REOPENING_SOURCES)[number]

export function isReopeningSource(value: unknown): value is ReopeningSource {
  return typeof value === "string" && (REOPENING_SOURCES as readonly string[]).includes(value)
}

export type ReopeningState = "pending" | "approved" | "rejected" | "withdrawn"

// The longest reason the database keeps.
export const REOPENING_REASON_MAX = 1000

// Shared by every call: the refusals any of them can meet.
type CommonError =
  // Signed out, or without the permission the call needs.
  | "forbidden"
  | "not-found"
  | "unavailable"

// ---------------------------------------------------------------------------
// Raising a request.
// ---------------------------------------------------------------------------

export type RaiseInput = {
  // Why the family is back. Required; blank counts as none.
  reason: string
  source: ReopeningSource
}

export type RaiseError =
  | { kind: CommonError }
  // A blank or over-long reason, or an unknown source.
  | { kind: "invalid" }
  // The lead is not Declined, Inactive or Archived: nothing to reopen.
  | { kind: "lead-open" }
  // Someone already asked, and the request is still Pending.
  | { kind: "already-pending"; requestedBy: string | null; requestedAt: string | null }

function pendingDetail(details: string | null | undefined): { requestedBy: string | null; requestedAt: string | null } {
  try {
    const parsed = details ? (JSON.parse(details) as { requested_by?: unknown; requested_at?: unknown }) : {}
    return {
      requestedBy: typeof parsed.requested_by === "string" ? parsed.requested_by : null,
      requestedAt: typeof parsed.requested_at === "string" ? parsed.requested_at : null,
    }
  } catch {
    return { requestedBy: null, requestedAt: null }
  }
}

// Asks for a closed lead to be reopened. Needs leads.create or leads.edit.
// Returns the new request's id.
export async function raiseReopeningRequest(
  supabase: SupabaseClient,
  leadId: string,
  { reason, source }: RaiseInput,
): Promise<Result<string, RaiseError>> {
  const { data, error } = await supabase.rpc("raise_reopening_request", { lead_id: leadId, reason, source })
  if (!error) return { ok: true, data: data as string }

  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
  // A malformed id is a missing lead, not an outage.
  if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
  if (error.message === "invalid") return { ok: false, error: { kind: "invalid" } }
  if (error.message === "lead_open") return { ok: false, error: { kind: "lead-open" } }
  if (error.message === "already_pending") {
    return { ok: false, error: { kind: "already-pending", ...pendingDetail(error.details) } }
  }
  console.error("Could not raise a reopening request", error)
  return { ok: false, error: { kind: "unavailable" } }
}

// ---------------------------------------------------------------------------
// Withdrawing a request.
// ---------------------------------------------------------------------------

export type WithdrawError =
  | CommonError
  // The request was already withdrawn or decided.
  | "not-pending"
  // Only the staff member who raised it may withdraw it.
  | "not-requester"

export async function withdrawReopeningRequest(
  supabase: SupabaseClient,
  requestId: string,
): Promise<Result<null, WithdrawError>> {
  const { error } = await supabase.rpc("withdraw_reopening_request", { request_id: requestId })
  if (!error) return { ok: true, data: null }

  if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
  if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
  if (error.message === "not_pending") return { ok: false, error: "not-pending" }
  if (error.message === "not_requester") return { ok: false, error: "not-requester" }
  console.error("Could not withdraw a reopening request", error)
  return { ok: false, error: "unavailable" }
}

// ---------------------------------------------------------------------------
// Approving and rejecting a request (#101).
// ---------------------------------------------------------------------------

// The statuses before a decline that ask the approver whether the lead
// retakes its interview or enrols without one.
export const RETAKE_CHOICE_STATUSES = ["Interviewed", "Enrolled"] as const satisfies readonly LeadStatus[]

// Whether approving a lead declined from `statusBefore` needs the retake
// choice. Null means the lead is not Declined.
export function needsRetakeChoice(statusBefore: LeadStatus | null): boolean {
  return statusBefore !== null && (RETAKE_CHOICE_STATUSES as readonly LeadStatus[]).includes(statusBefore)
}

export type DecisionError =
  | CommonError
  // A missing or unwanted retake choice, or a rejection without a reason or
  // with one too long.
  | "invalid"
  // The request was already withdrawn or decided.
  | "not-pending"

function decisionError(error: { message: string; code?: string }, doing: string): DecisionError {
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  if (error.message === "not_found" || error.code === "22P02") return "not-found"
  if (error.message === "invalid") return "invalid"
  if (error.message === "not_pending") return "not-pending"
  console.error(`Could not ${doing} a reopening request`, error)
  return "unavailable"
}

export type ApproveInput = {
  // Required when the lead was declined from Interviewed or Enrolled: true
  // to enrol without a retaken interview, false to retake it. Left out
  // otherwise.
  enrolWithoutRetake?: boolean
}

// Approves a Pending request and reopens its lead: a Declined lead back to
// its status before the decline (Interviewed in place of Enrolled), any
// closure mark cleared. Needs reopenings.approve. The same approval sent
// again by the same approver succeeds without changing anything.
export async function approveReopeningRequest(
  supabase: SupabaseClient,
  requestId: string,
  { enrolWithoutRetake }: ApproveInput = {},
): Promise<Result<null, DecisionError>> {
  const { error } = await supabase.rpc("approve_reopening_request", {
    request_id: requestId,
    enrol_without_retake: enrolWithoutRetake ?? null,
  })
  if (!error) return { ok: true, data: null }
  return { ok: false, error: decisionError(error, "approve") }
}

export type RejectInput = {
  // Why, for the requester to read on the lead. Required; blank counts as
  // none.
  reason: string
}

// Rejects a Pending request with a written reason; the lead stays closed.
// Needs reopenings.approve. The same rejection sent again by the same
// approver succeeds without changing anything.
export async function rejectReopeningRequest(
  supabase: SupabaseClient,
  requestId: string,
  { reason }: RejectInput,
): Promise<Result<null, DecisionError>> {
  const { error } = await supabase.rpc("reject_reopening_request", { request_id: requestId, reason })
  if (!error) return { ok: true, data: null }
  return { ok: false, error: decisionError(error, "reject") }
}

// ---------------------------------------------------------------------------
// A lead's requests.
// ---------------------------------------------------------------------------

export type ReopeningRequest = {
  id: string
  source: ReopeningSource
  reason: string
  state: ReopeningState
  requestedAt: string
  // The requester's staff id, so the screen can offer Withdraw to them alone,
  // and their name, looked up now.
  requestedById: string
  requestedBy: string
  // Set once the request leaves Pending: the approver, the rejecter, or the
  // requester withdrawing it.
  decidedAt: string | null
  decidedBy: string | null
  rejectionReason: string | null
  // Set on approval: the retake choice (null when it didn't apply), whether
  // the lead was Declined, and the status it came back with.
  enrolWithoutRetake: boolean | null
  leadWasDeclined: boolean | null
  restoredStatus: LeadStatus | null
}

export type LeadReopenings = {
  // The one Pending request, if any.
  pending: ReopeningRequest | null
  // Every request no longer Pending, newest first. The first is the most
  // recent decided one.
  decided: ReopeningRequest[]
}

export type LeadReopeningsError = CommonError

type RequestRow = {
  id: string
  source: ReopeningSource
  reason: string
  state: ReopeningState
  requested_at: string
  requested_by_id: string
  requested_by: string
  decided_at: string | null
  decided_by: string | null
  rejection_reason: string | null
  enrol_without_retake: boolean | null
  lead_was_declined: boolean | null
  restored_status: LeadStatus | null
}

// The lead's Pending request and every earlier one, for staff who may view
// leads.
export async function getLeadReopenings(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadReopenings, LeadReopeningsError>> {
  const { data, error } = await supabase.rpc("lead_reopening_requests", { lead_id: leadId })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not read a lead's reopening requests", error)
    return { ok: false, error: "unavailable" }
  }

  const requests = ((data ?? []) as RequestRow[]).map(
    (row): ReopeningRequest => ({
      id: row.id,
      source: row.source,
      reason: row.reason,
      state: row.state,
      requestedAt: row.requested_at,
      requestedById: row.requested_by_id,
      requestedBy: row.requested_by,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
      rejectionReason: row.rejection_reason,
      enrolWithoutRetake: row.enrol_without_retake ?? null,
      leadWasDeclined: row.lead_was_declined ?? null,
      restoredStatus: row.restored_status ?? null,
    }),
  )
  // Requests leave Pending in the order they were raised, so newest raised is
  // also newest decided.
  return {
    ok: true,
    data: {
      pending: requests.find((request) => request.state === "pending") ?? null,
      decided: requests.filter((request) => request.state !== "pending"),
    },
  }
}
