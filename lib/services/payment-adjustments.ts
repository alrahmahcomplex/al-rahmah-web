import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"
import type { RecordedPaymentType, SeatPriority } from "./school-fee-payments"

// Payment adjustments (#110): how the Accountant corrects a recorded
// school-fee payment without changing it. An adjustment states what the
// payment should have said, or voids it; the newest adjustment wins. Every
// rule lives in the database; this file turns its answers into a Result.

export const ADJUSTMENT_REASONS = [
  "Wrong amount",
  "Wrong payment type",
  "Wrong payment date",
  "Duplicate entry",
  "Data-entry correction",
] as const
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number]

// Voiding needs Duplicate entry, and Duplicate entry always voids.
export const VOID_REASON: AdjustmentReason = "Duplicate entry"
// The only reason that brings a voided payment back.
export const RESTORE_REASON: AdjustmentReason = "Data-entry correction"

export function isAdjustmentReason(value: unknown): value is AdjustmentReason {
  return typeof value === "string" && (ADJUSTMENT_REASONS as readonly string[]).includes(value)
}

// One adjustment as the lead screen lists it.
export type PaymentAdjustment = {
  id: string
  reason: AdjustmentReason
  voided: boolean
  // What the payment should have said; null when voided. The amount is null
  // for Fee waived too.
  type: RecordedPaymentType | null
  amount: number | null
  paidOn: string | null
  note: string | null
  recordedAt: string
  // Looked up when read, so a deactivated staff member still shows by name.
  recordedBy: string | null
}

export type AdjustmentInput =
  | { reason: AdjustmentReason; void: true; note: string | null }
  | {
      reason: AdjustmentReason
      void: false
      type: RecordedPaymentType
      // Whole TZS above zero; null for Fee waived.
      amount: number | null
      // YYYY-MM-DD, today in Tanzania or earlier.
      paidOn: string
      note: string | null
    }

export type AdjustmentError =
  | "invalid_reason"
  // A void needs Duplicate entry, and Duplicate entry always voids.
  | "void_needs_duplicate"
  | "duplicate_needs_void"
  // A voided payment comes back only with Data-entry correction.
  | "restore_needs_correction"
  | "invalid_type"
  // The type changes the Fee waived and Pre-Form One rules rule out.
  | "type_to_fee_waived"
  | "type_from_fee_waived"
  | "type_pre_form_one"
  // Restoring a Fee waived payment while another one counts.
  | "already_waived"
  | "amount_not_positive"
  | "amount_not_whole"
  | "amount_too_large"
  | "date_missing"
  | "date_in_future"
  | "note_too_long"
  // The adjustment would leave the payment as it already counts.
  | "unchanged"
  | "forbidden"
  | "not_found"
  | "unavailable"

const REFUSALS: ReadonlySet<string> = new Set<AdjustmentError>([
  "invalid_reason",
  "void_needs_duplicate",
  "duplicate_needs_void",
  "restore_needs_correction",
  "invalid_type",
  "type_to_fee_waived",
  "type_from_fee_waived",
  "type_pre_form_one",
  "already_waived",
  "amount_not_positive",
  "amount_not_whole",
  "amount_too_large",
  "date_missing",
  "date_in_future",
  "note_too_long",
  "unchanged",
])

export type AdjustedPayment = { adjustmentId: string; totalPaid: number; priority: SeatPriority | null }

type AdjustedRow = { adjustment_id: string; total_paid: number; priority: SeatPriority | null }

// Adjusts the payment under the signed-in staff member and recomputes its
// lead's Seat priority and Enrolled. Works on a closed lead too. Needs
// payments.record.
//
// `requestId` names this one adjustment: the caller makes it once and sends
// it again on a retry, which then returns the adjustment already made.
export async function adjustPayment(
  supabase: SupabaseClient,
  paymentId: string,
  adjustment: AdjustmentInput,
  requestId: string,
): Promise<Result<AdjustedPayment, AdjustmentError>> {
  const { data, error } = await supabase.rpc("adjust_school_fee_payment", {
    payment_id: paymentId,
    reason: adjustment.reason,
    voided: adjustment.void,
    payment_type: adjustment.void ? null : adjustment.type,
    amount: adjustment.void ? null : adjustment.amount,
    paid_on: adjustment.void ? null : adjustment.paidOn,
    note: adjustment.note,
    request_id: requestId,
  })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    // 22P02: the payment id isn't a uuid, so no payment has it.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not_found" }
    if (REFUSALS.has(error.message)) return { ok: false, error: error.message as AdjustmentError }
    // 22007/22008: a date the database can't read.
    if (error.code === "22007" || error.code === "22008") return { ok: false, error: "date_missing" }
    console.error("Could not adjust a school-fee payment", error)
    return { ok: false, error: "unavailable" }
  }
  const row = data as AdjustedRow
  return { ok: true, data: { adjustmentId: row.adjustment_id, totalPaid: row.total_paid, priority: row.priority } }
}

export type AdjustmentRow = {
  id: string
  reason: AdjustmentReason
  voided: boolean
  payment_type: RecordedPaymentType | null
  amount: number | null
  paid_on: string | null
  note: string | null
  recorded_at: string
  recorded_by_name: string | null
}

export function toAdjustment(row: AdjustmentRow): PaymentAdjustment {
  return {
    id: row.id,
    reason: row.reason,
    voided: row.voided,
    type: row.payment_type,
    amount: row.amount,
    paidOn: row.paid_on,
    note: row.note,
    recordedAt: row.recorded_at,
    recordedBy: row.recorded_by_name,
  }
}
