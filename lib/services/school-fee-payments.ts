import type { SupabaseClient } from "@supabase/supabase-js"

import { toAdjustment, type AdjustmentRow, type PaymentAdjustment } from "./payment-adjustments"
import type { Result } from "./result"

// School-fee payments: what the Accountant records against a lead's School
// fee, and the Seat priority the database derives from them. Every rule lives
// in the database; this file turns its answers into a Result.

// The types a payment can be recorded with now. Fee waived and the Pre-Form
// One fee arrive with their own tickets.
export const PAYMENT_TYPES = [
  "full_payment",
  "initial_deposit",
  "first_instalment",
  "second_instalment",
  "third_instalment",
] as const
export type PaymentType = (typeof PAYMENT_TYPES)[number]

// Every type a recorded payment may carry.
export type RecordedPaymentType = PaymentType | "fee_waived" | "pre_form_one_fee"

export const PAYMENT_TYPE_NAMES: Record<RecordedPaymentType, string> = {
  full_payment: "Full payment",
  initial_deposit: "Initial deposit",
  first_instalment: "First instalment",
  second_instalment: "Second instalment",
  third_instalment: "Third instalment",
  fee_waived: "Fee waived",
  pre_form_one_fee: "Pre-Form One fee",
}

export function isPaymentType(value: unknown): value is PaymentType {
  return typeof value === "string" && (PAYMENT_TYPES as readonly string[]).includes(value)
}

// Lowest first. A lead with less than the minimum Initial deposit has none.
export const SEAT_PRIORITIES = ["Deposit", "First instalment", "Full"] as const
export type SeatPriority = (typeof SEAT_PRIORITIES)[number]

export type PaymentInput = {
  type: PaymentType
  // Whole TZS above zero.
  amount: number
  // YYYY-MM-DD, today in Tanzania or earlier.
  paidOn: string
}

export type PaymentError =
  | "lead_closed"
  // The lead's current interview isn't Passed.
  | "not_passed"
  // The lead's enrollment year has no Fee schedule.
  | "no_schedule"
  | "invalid_type"
  | "amount_not_positive"
  | "amount_not_whole"
  | "amount_too_large"
  | "date_missing"
  | "date_in_future"
  | "forbidden"
  | "not_found"
  | "unavailable"

const REFUSALS: ReadonlySet<string> = new Set<PaymentError>([
  "lead_closed",
  "not_passed",
  "no_schedule",
  "invalid_type",
  "amount_not_positive",
  "amount_not_whole",
  "amount_too_large",
  "date_missing",
  "date_in_future",
])

type RpcError = { message: string; code?: string }

function paymentError(error: RpcError, doing: string): PaymentError {
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  // 22P02: the lead id isn't a uuid, so no lead has it.
  if (error.message === "not_found" || error.code === "22P02") return "not_found"
  if (REFUSALS.has(error.message)) return error.message as PaymentError
  // 22007/22008: a date the database can't read.
  if (error.code === "22007" || error.code === "22008") return "date_missing"
  console.error(`Could not ${doing}`, error)
  return "unavailable"
}

function rpcArgs(leadId: string, { type, amount, paidOn }: PaymentInput) {
  return { lead_id: leadId, payment_type: type, amount, paid_on: paidOn }
}

// ---------------------------------------------------------------------------
// The preview before recording.
// ---------------------------------------------------------------------------

export type PaymentPreview = {
  schoolFee: number
  totalPaid: number
  totalPaidAfter: number
  balanceAfter: number
  priority: SeatPriority | null
  priorityAfter: SeatPriority | null
  // The lead's class: its seats set (null when not set) and the seats taken
  // by other leads.
  seats: number | null
  seatsTaken: number
  // The payment would give the lead a seat in a class whose seats taken
  // already reach its seats set. A warning only: recording still goes ahead.
  wouldOverfill: boolean
}

type PreviewRow = {
  school_fee: number
  total_paid: number
  total_paid_after: number
  balance_after: number
  priority: SeatPriority | null
  priority_after: SeatPriority | null
  seats: number | null
  seats_taken: number
  would_overfill: boolean
}

// What recording the payment would do: the new Total paid, balance and Seat
// priority, and whether it would overfill the lead's class. Records nothing. Refuses exactly what recordPayment refuses.
// Needs payments.record.
export async function previewPayment(
  supabase: SupabaseClient,
  leadId: string,
  payment: PaymentInput,
): Promise<Result<PaymentPreview, PaymentError>> {
  const { data, error } = await supabase.rpc("preview_school_fee_payment", rpcArgs(leadId, payment))
  if (error) return { ok: false, error: paymentError(error, "preview a school-fee payment") }
  const row = data as PreviewRow
  return {
    ok: true,
    data: {
      schoolFee: row.school_fee,
      totalPaid: row.total_paid,
      totalPaidAfter: row.total_paid_after,
      balanceAfter: row.balance_after,
      priority: row.priority,
      priorityAfter: row.priority_after,
      seats: row.seats,
      seatsTaken: row.seats_taken,
      wouldOverfill: row.would_overfill,
    },
  }
}

// ---------------------------------------------------------------------------
// Recording.
// ---------------------------------------------------------------------------

export type RecordedPayment = { paymentId: string; totalPaid: number; priority: SeatPriority | null }

type RecordedRow = { payment_id: string; total_paid: number; priority: SeatPriority | null }

// Records the payment under the signed-in staff member, on a lead whose
// current interview is Passed and whose year has a Fee schedule. The payment
// is locked once recorded. Needs payments.record.
//
// `requestId` names this one payment: the caller makes it once and sends it
// again on a retry, which then returns the payment already recorded instead
// of recording a second one.
export async function recordPayment(
  supabase: SupabaseClient,
  leadId: string,
  payment: PaymentInput,
  requestId: string,
): Promise<Result<RecordedPayment, PaymentError>> {
  const { data, error } = await supabase.rpc("record_school_fee_payment", {
    ...rpcArgs(leadId, payment),
    request_id: requestId,
  })
  if (error) return { ok: false, error: paymentError(error, "record a school-fee payment") }
  const row = data as RecordedRow
  return { ok: true, data: { paymentId: row.payment_id, totalPaid: row.total_paid, priority: row.priority } }
}

// ---------------------------------------------------------------------------
// Reading.
// ---------------------------------------------------------------------------

// What a payment says: as recorded, or as its newest adjustment corrected it.
export type PaymentValues = {
  type: RecordedPaymentType
  // Empty only for Fee waived.
  amount: number | null
  paidOn: string
}

// A payment's original entry, how it counts now, and every adjustment made
// to it.
export type SchoolFeePayment = PaymentValues & {
  id: string
  recordedAt: string
  // Looked up when read, so a deactivated staff member still shows by name.
  recordedBy: string | null
  // The newest adjustment's values, or the original's; null once voided.
  effective: PaymentValues | null
  // Oldest first.
  adjustments: PaymentAdjustment[]
}

type PaymentRow = {
  id: string
  payment_type: RecordedPaymentType
  amount: number | null
  paid_on: string
  recorded_at: string
  recorded_by_name: string | null
  voided: boolean
  effective_type: RecordedPaymentType | null
  effective_amount: number | null
  effective_paid_on: string | null
  adjustments: AdjustmentRow[]
}

// A lead's payments, newest effective payment date first, each with its
// adjustments. Needs leads.view and payments.view.
export async function listPayments(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<SchoolFeePayment[], "forbidden" | "not-found" | "unavailable">> {
  const { data, error } = await supabase.rpc("lead_school_fee_payments", { lead_id: leadId })
  if (error) {
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not list a lead's school-fee payments", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as PaymentRow[]).map((row) => ({
      id: row.id,
      type: row.payment_type,
      amount: row.amount,
      paidOn: row.paid_on,
      recordedAt: row.recorded_at,
      recordedBy: row.recorded_by_name,
      effective:
        row.voided || row.effective_type === null || row.effective_paid_on === null
          ? null
          : { type: row.effective_type, amount: row.effective_amount, paidOn: row.effective_paid_on },
      adjustments: (row.adjustments ?? []).map(toAdjustment),
    })),
  }
}

export type LeadSeatPriority = { priority: SeatPriority; reachedOn: string }

// The most leads one call may ask about: a page of the lead list is 50.
export const SEAT_PRIORITIES_PER_REQUEST = 200

// The Seat priority of each given lead that has one, by lead id, for the
// lead list's badges. Needs leads.view and payments.view.
export async function listSeatPriorities(
  supabase: SupabaseClient,
  leadIds: readonly string[],
): Promise<Result<Record<string, LeadSeatPriority>, "forbidden" | "unavailable">> {
  if (leadIds.length === 0) return { ok: true, data: {} }
  if (leadIds.length > SEAT_PRIORITIES_PER_REQUEST) throw new Error("Too many leads for one Seat priority request")
  const { data, error } = await supabase.rpc("lead_seat_priorities", { lead_ids: leadIds })
  if (error) {
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read leads' Seat priorities", error)
    return { ok: false, error: "unavailable" }
  }
  const priorities: Record<string, LeadSeatPriority> = {}
  for (const row of (data ?? []) as { lead_id: string; priority: SeatPriority; reached_on: string }[]) {
    priorities[row.lead_id] = { priority: row.priority, reachedOn: row.reached_on }
  }
  return { ok: true, data: priorities }
}
