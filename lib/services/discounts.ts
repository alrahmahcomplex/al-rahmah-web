import type { SupabaseClient } from "@supabase/supabase-js"

import type { DayOrBoarding, LeadClass } from "./leads"
import type { Result } from "./result"

// Staff child and Qualified orphan discounts (#112), part of the fees module
// in a file of its own. Admissions Staff request one on a lead with a note;
// the Admissions Manager grants it or refuses it with a reason. A granted
// discount lowers the lead's School fee, which getLeadFee then names. Every
// rule lives in the database; these calls only translate what it answers.

export const DISCOUNT_KINDS = ["staff_child", "qualified_orphan"] as const
export type DiscountKind = (typeof DISCOUNT_KINDS)[number]

export const DISCOUNT_NAMES: Record<DiscountKind, string> = {
  staff_child: "Staff child",
  qualified_orphan: "Qualified orphan",
}

// What each takes off the School fee.
export const DISCOUNT_PERCENTS: Record<DiscountKind, number> = {
  staff_child: 25,
  qualified_orphan: 100,
}

export function isDiscountKind(value: unknown): value is DiscountKind {
  return typeof value === "string" && (DISCOUNT_KINDS as readonly string[]).includes(value)
}

export type DiscountRequestState = "pending" | "granted" | "refused"

// The longest note or refusal reason the database keeps.
export const DISCOUNT_TEXT_MAX = 1000

type CommonError =
  // Signed out, or without the permission the call needs.
  | "forbidden"
  | "not-found"
  | "unavailable"

type RpcError = { message: string; code?: string; details?: string | null }

function commonError(error: RpcError): CommonError | null {
  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  // 22P02: an id that isn't a uuid, so nothing has it.
  if (error.message === "not_found" || error.code === "22P02") return "not-found"
  return null
}

// ---------------------------------------------------------------------------
// Requesting.
// ---------------------------------------------------------------------------

export type RequestDiscountError =
  | { kind: CommonError }
  // An unknown kind, or a blank or over-long note.
  | { kind: "invalid"; field: "kind" | "note" | null }
  | { kind: "lead-closed" }
  // Someone already asked, and the request is still Pending.
  | { kind: "already-pending"; requestedBy: string | null; requestedAt: string | null }
  // The lead already holds this discount.
  | { kind: "already-granted" }

function detailOf(details: string | null | undefined): Record<string, unknown> {
  try {
    const parsed: unknown = details ? JSON.parse(details) : {}
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

// Requests a Staff child or Qualified orphan discount on an open lead, with a
// note for the Manager. Needs leads.edit. Returns the request's id.
//
// `requestId` names this one request: the caller makes it once and sends it
// again on a retry, which returns the request already made.
export async function requestDiscount(
  supabase: SupabaseClient,
  leadId: string,
  kind: DiscountKind,
  note: string,
  requestId: string,
): Promise<Result<string, RequestDiscountError>> {
  const { data, error } = await supabase.rpc("request_discount", { lead_id: leadId, kind, note, request_id: requestId })
  if (!error) return { ok: true, data: data as string }

  const common = commonError(error)
  if (common) return { ok: false, error: { kind: common } }
  if (error.message === "invalid") {
    const field = detailOf(error.details).field
    return { ok: false, error: { kind: "invalid", field: field === "kind" || field === "note" ? field : null } }
  }
  if (error.message === "lead_closed") return { ok: false, error: { kind: "lead-closed" } }
  if (error.message === "already_granted") return { ok: false, error: { kind: "already-granted" } }
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
  console.error("Could not request a discount", error)
  return { ok: false, error: { kind: "unavailable" } }
}

// ---------------------------------------------------------------------------
// Deciding.
// ---------------------------------------------------------------------------

export type DiscountDecision = { decision: "grant" } | { decision: "refuse"; reason: string }

export type DecideDiscountError =
  | CommonError
  // A refusal without a reason, or with one too long.
  | "invalid"
  // A grant on a Declined, Inactive or Archived lead.
  | "lead-closed"
  // The request was already decided.
  | "not-pending"

// Grants a Pending request, which lowers the lead's School fee at once and
// may enrol it, or refuses it with a reason the requester reads on the lead.
// Needs discounts.approve. The same decision sent again by the same Manager
// succeeds without changing anything.
export async function decideDiscount(
  supabase: SupabaseClient,
  requestId: string,
  decision: DiscountDecision,
): Promise<Result<null, DecideDiscountError>> {
  const { error } = await supabase.rpc("decide_discount", {
    request_id: requestId,
    decision: decision.decision,
    reason: decision.decision === "refuse" ? decision.reason : null,
  })
  if (!error) return { ok: true, data: null }

  const common = commonError(error)
  if (common) return { ok: false, error: common }
  if (error.message === "invalid") return { ok: false, error: "invalid" }
  if (error.message === "lead_closed") return { ok: false, error: "lead-closed" }
  if (error.message === "not_pending") return { ok: false, error: "not-pending" }
  console.error("Could not decide a discount request", error)
  return { ok: false, error: "unavailable" }
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

export type DiscountRequest = {
  id: string
  kind: DiscountKind
  note: string
  state: DiscountRequestState
  requestedAt: string
  // The requester's staff id, and their name, looked up now.
  requestedById: string
  requestedBy: string | null
  // Set once the request is decided.
  decidedAt: string | null
  decidedBy: string | null
  refusalReason: string | null
}

export type LeadDiscounts = {
  // The one Pending request, if any.
  pending: DiscountRequest | null
  // Granted and refused requests, newest first.
  decided: DiscountRequest[]
}

type LeadRequestRow = {
  id: string
  kind: DiscountKind
  note: string
  state: DiscountRequestState
  requested_at: string
  requested_by_id: string
  requested_by: string | null
  decided_at: string | null
  decided_by: string | null
  refusal_reason: string | null
}

// A lead's discount requests, for staff who may view leads.
export async function getLeadDiscounts(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadDiscounts, CommonError>> {
  const { data, error } = await supabase.rpc("lead_discount_requests", { lead_id: leadId })
  if (error) {
    const common = commonError(error)
    if (common) return { ok: false, error: common }
    console.error("Could not read a lead's discount requests", error)
    return { ok: false, error: "unavailable" }
  }
  const requests = ((data ?? []) as LeadRequestRow[]).map(
    (row): DiscountRequest => ({
      id: row.id,
      kind: row.kind,
      note: row.note,
      state: row.state,
      requestedAt: row.requested_at,
      requestedById: row.requested_by_id,
      requestedBy: row.requested_by,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
      refusalReason: row.refusal_reason,
    }),
  )
  return {
    ok: true,
    data: {
      pending: requests.find((request) => request.state === "pending") ?? null,
      decided: requests.filter((request) => request.state !== "pending"),
    },
  }
}

export type PendingDiscountRequest = {
  id: string
  leadId: string
  admissionNumber: string
  studentName: string
  className: LeadClass
  enrollmentYear: number
  dayOrBoarding: DayOrBoarding
  // False once the lead is Declined or carries a closure mark: the request
  // can then only be refused.
  leadOpen: boolean
  kind: DiscountKind
  note: string
  requestedAt: string
  requestedBy: string | null
}

type PendingRow = {
  id: string
  lead_id: string
  admission_number: string
  student_name: string
  class_name: LeadClass
  enrollment_year: number
  day_or_boarding: DayOrBoarding
  lead_open: boolean
  kind: DiscountKind
  note: string
  requested_at: string
  requested_by: string | null
}

// Every Pending request, oldest first, for the Manager's Discount requests
// screen. Needs discounts.approve.
export async function listPendingDiscountRequests(
  supabase: SupabaseClient,
): Promise<Result<PendingDiscountRequest[], "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("pending_discount_requests")
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not list pending discount requests", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as PendingRow[]).map((row) => ({
      id: row.id,
      leadId: row.lead_id,
      admissionNumber: row.admission_number,
      studentName: row.student_name,
      className: row.class_name,
      enrollmentYear: row.enrollment_year,
      dayOrBoarding: row.day_or_boarding,
      leadOpen: row.lead_open,
      kind: row.kind,
      note: row.note,
      requestedAt: row.requested_at,
      requestedBy: row.requested_by,
    })),
  }
}

// How many requests are Pending, for the navigation's count. Read through
// the table, which staff who may view leads can read.
export async function countPendingDiscountRequests(
  supabase: SupabaseClient,
): Promise<Result<number, "unavailable">> {
  const { count, error } = await supabase
    .from("discount_requests")
    .select("id", { count: "exact", head: true })
    .eq("state", "pending")
  if (error || count === null) {
    console.error("Could not count pending discount requests", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: count }
}
