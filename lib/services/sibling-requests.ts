import type { SupabaseClient } from "@supabase/supabase-js"

import type { DayOrBoarding, LeadClass, LeadStatus } from "./leads"
import type { Result } from "./result"

// Sibling discount requests (#302). When the fathers' names don't match,
// staff with leads.edit ask the Admissions Manager to let a linked lead count
// in its sibling group, or to bring its group into another lead's group. The
// Manager decides with discounts.approve, through decide_discount as for the
// other kinds. A grant for a student already Enrolled leaves its fee alone
// and asks the Accountant for a fee edit. Every rule lives in the database;
// these calls only translate what it answers. The screens come in #310 and
// #311.

export type SiblingRequestState = "pending" | "granted" | "refused" | "withdrawn"

// Why a request was withdrawn: the lead left the group it asked about, or it
// was linked into it by a match.
export type SiblingWithdrawnReason = "left_group" | "already_linked"

// "Granted: fee edit needed" and how it was closed.
export type SiblingFeeEdit = "needed" | "applied" | "dismissed"

export type SiblingRequest = {
  id: string
  leadId: string
  state: SiblingRequestState
  note: string
  groupId: string
  // True when the lead asks to bring its own group into another lead's.
  acrossGroups: boolean
  siblingOfLeadId: string | null
  siblingOfStudentName: string | null
  siblingOfFatherFullName: string | null
  requestedAt: string
  requestedById: string
  requestedBy: string | null
  decidedAt: string | null
  decidedBy: string | null
  refusalReason: string | null
  withdrawnBy: string | null
  withdrawnReason: SiblingWithdrawnReason | null
  feeEdit: SiblingFeeEdit | null
  feeEditClosedAt: string | null
  feeEditClosedBy: string | null
  feeEditReason: string | null
}

export type PendingSiblingRequest = SiblingRequest & {
  admissionNumber: string
  studentName: string
  fatherFullName: string | null
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
  status: LeadStatus
  // False once the lead is Declined or carries a closure mark: the request
  // can then only be refused.
  leadOpen: boolean
}

type RequestRow = {
  id: string
  lead_id: string
  state: SiblingRequestState
  note: string
  group_id: string
  across_groups: boolean
  sibling_of_lead_id: string | null
  sibling_of_student_name: string | null
  sibling_of_father_full_name: string | null
  requested_at: string
  requested_by_id: string
  requested_by: string | null
  decided_at: string | null
  decided_by: string | null
  refusal_reason: string | null
  withdrawn_by: string | null
  withdrawn_reason: SiblingWithdrawnReason | null
  fee_edit: SiblingFeeEdit | null
  fee_edit_closed_at: string | null
  fee_edit_closed_by: string | null
  fee_edit_reason: string | null
}

type PendingRow = RequestRow & {
  admission_number: string
  student_name: string
  father_full_name: string | null
  class_name: LeadClass
  enrollment_year: number
  day_or_boarding: DayOrBoarding
  status: LeadStatus
  lead_open: boolean
}

function toRequest(row: RequestRow): SiblingRequest {
  return {
    id: row.id,
    leadId: row.lead_id,
    state: row.state,
    note: row.note,
    groupId: row.group_id,
    acrossGroups: row.across_groups,
    siblingOfLeadId: row.sibling_of_lead_id,
    siblingOfStudentName: row.sibling_of_student_name,
    siblingOfFatherFullName: row.sibling_of_father_full_name,
    requestedAt: row.requested_at,
    requestedById: row.requested_by_id,
    requestedBy: row.requested_by,
    decidedAt: row.decided_at,
    decidedBy: row.decided_by,
    refusalReason: row.refusal_reason,
    withdrawnBy: row.withdrawn_by,
    withdrawnReason: row.withdrawn_reason,
    feeEdit: row.fee_edit,
    feeEditClosedAt: row.fee_edit_closed_at,
    feeEditClosedBy: row.fee_edit_closed_by,
    feeEditReason: row.fee_edit_reason,
  }
}

type CommonError = "forbidden" | "not-found" | "unavailable"

type RpcError = { message: string; code?: string; details?: string | null }

function commonError(error: RpcError): CommonError | null {
  // 42501: the function isn't granted to the caller at all.
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  // 22P02: an id that isn't a uuid, so nothing has it.
  if (error.message === "not_found" || error.code === "22P02") return "not-found"
  return null
}

function detailOf(details: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = details ? JSON.parse(details) : {}
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Requesting.
// ---------------------------------------------------------------------------

// Why a request can't be made, from the database's `sibling_of` reasons:
// the lead (or the other lead) isn't linked into a group; both are already
// in one group; the lead doesn't count in its own group, so it asks there
// first; it is alone in its group, so it is simply linked; or the names are
// the same, so it is simply linked.
export type SiblingRequestReason = "not_linked" | "same_group" | "not_counting" | "no_merge" | "names_match"

export type RequestSiblingDiscountError =
  | { kind: CommonError }
  | { kind: "invalid"; field: "note" | "sibling_of" | null; reason: SiblingRequestReason | null }
  | { kind: "lead-closed" }
  // The lead already counts in that group.
  | { kind: "already-counts" }
  | { kind: "already-pending"; requestedBy: string | null; requestedAt: string | null }

const REQUEST_REASONS: readonly string[] = ["not_linked", "same_group", "not_counting", "no_merge", "names_match"]

// Asks for a Sibling request on an open lead, Enrolled included, with a note
// on the proof. Without `siblingOfLeadId` the lead asks to count in its own
// group; with it, the lead asks to bring its group into that lead's group.
// Needs leads.edit. `requestId` names this one request: send it again on a
// retry. Returns the request's id.
export async function requestSiblingDiscount(
  supabase: SupabaseClient,
  input: { leadId: string; note: string; requestId: string; siblingOfLeadId?: string },
): Promise<Result<string, RequestSiblingDiscountError>> {
  const { data, error } = await supabase.rpc("request_sibling_discount", {
    lead_id: input.leadId,
    note: input.note,
    request_id: input.requestId,
    sibling_of_lead_id: input.siblingOfLeadId ?? null,
  })
  if (!error) return { ok: true, data: data as string }

  const common = commonError(error)
  if (common) return { ok: false, error: { kind: common } }
  if (error.message === "invalid") {
    const detail = detailOf(error.details)
    const field = detail.field === "note" || detail.field === "sibling_of" ? detail.field : null
    const reason =
      typeof detail.reason === "string" && REQUEST_REASONS.includes(detail.reason)
        ? (detail.reason as SiblingRequestReason)
        : null
    return { ok: false, error: { kind: "invalid", field, reason } }
  }
  if (error.message === "lead_closed") return { ok: false, error: { kind: "lead-closed" } }
  if (error.message === "already_counts") return { ok: false, error: { kind: "already-counts" } }
  if (error.message === "already_pending") {
    const detail = detailOf(error.details)
    return {
      ok: false,
      error: {
        kind: "already-pending",
        requestedBy: typeof detail.requested_by === "string" ? detail.requested_by : null,
        requestedAt: typeof detail.requested_at === "string" ? detail.requested_at : null,
      },
    }
  }
  console.error("Could not request a Sibling discount", error)
  return { ok: false, error: { kind: "unavailable" } }
}

// ---------------------------------------------------------------------------
// Deciding.
// ---------------------------------------------------------------------------

export type DecideSiblingRequestError =
  | CommonError
  // A refusal without a reason, or with one too long.
  | "invalid"
  | "lead-closed"
  | "not-pending"
  // The lead has moved since the request was made: it can only be refused.
  | "stale"
  // Across groups: another refusal stands between the two groups.
  | "refused-request"

// Grants a Pending Sibling request, or refuses it with a reason. Needs
// discounts.approve. The same decision sent again by the same Manager
// succeeds without changing anything.
export async function decideSiblingRequest(
  supabase: SupabaseClient,
  requestId: string,
  decision: { decision: "grant" } | { decision: "refuse"; reason: string },
): Promise<Result<null, DecideSiblingRequestError>> {
  const { error } = await supabase.rpc("decide_discount", {
    request_id: requestId,
    decision: decision.decision,
    reason: decision.decision === "refuse" ? decision.reason : null,
  })
  if (!error) return { ok: true, data: null }

  const common = commonError(error)
  if (common) return { ok: false, error: common }
  if (error.message === "invalid") {
    const reason = detailOf(error.details).reason
    if (reason === "stale") return { ok: false, error: "stale" }
    if (reason === "refused_request") return { ok: false, error: "refused-request" }
    return { ok: false, error: "invalid" }
  }
  if (error.message === "lead_closed") return { ok: false, error: "lead-closed" }
  if (error.message === "not_pending") return { ok: false, error: "not-pending" }
  console.error("Could not decide a Sibling request", error)
  return { ok: false, error: "unavailable" }
}

// ---------------------------------------------------------------------------
// "Granted: fee edit needed".
// ---------------------------------------------------------------------------

export type DismissSiblingFeeEditError = CommonError | "invalid" | "not-needed"

// Closes "Granted: fee edit needed" on a lead without editing its fee, with
// a reason. Needs payments.record.
export async function dismissSiblingFeeEdit(
  supabase: SupabaseClient,
  leadId: string,
  reason: string,
): Promise<Result<null, DismissSiblingFeeEditError>> {
  const { error } = await supabase.rpc("dismiss_sibling_fee_edit", { lead_id: leadId, reason })
  if (!error) return { ok: true, data: null }

  const common = commonError(error)
  if (common) return { ok: false, error: common }
  if (error.message === "invalid") return { ok: false, error: "invalid" }
  if (error.message === "not_needed") return { ok: false, error: "not-needed" }
  console.error("Could not dismiss a Sibling fee edit", error)
  return { ok: false, error: "unavailable" }
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

// A lead's Sibling requests, newest first, for staff who may view leads.
export async function getLeadSiblingRequests(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<SiblingRequest[], CommonError>> {
  const { data, error } = await supabase.rpc("lead_sibling_requests", { lead_id: leadId })
  if (error) {
    const common = commonError(error)
    if (common) return { ok: false, error: common }
    console.error("Could not read a lead's Sibling requests", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: ((data ?? []) as RequestRow[]).map(toRequest) }
}

// Every Pending Sibling request, oldest first, for the Manager. Needs
// discounts.approve.
export async function listPendingSiblingRequests(
  supabase: SupabaseClient,
): Promise<Result<PendingSiblingRequest[], "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("pending_sibling_requests")
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not list pending Sibling requests", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as PendingRow[]).map((row) => ({
      ...toRequest(row),
      admissionNumber: row.admission_number,
      studentName: row.student_name,
      fatherFullName: row.father_full_name,
      className: row.class_name,
      enrollmentYear: row.enrollment_year,
      dayOrBoarding: row.day_or_boarding,
      status: row.status,
      leadOpen: row.lead_open,
    })),
  }
}
