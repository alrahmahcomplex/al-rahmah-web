"use server"

import { revalidatePath } from "next/cache"

import { adjustPayment, isAdjustmentReason, type AdjustmentInput } from "@/lib/services/payment-adjustments"
import { PAYMENT_TYPE_NAMES, type RecordedPaymentType } from "@/lib/services/school-fee-payments"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { adjustedPaymentOutcome, adjustmentRefusal, type AdjustmentRefusal, type AdjustPaymentOutcome } from "./adjustment-outcome"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecordedType(value: unknown): value is RecordedPaymentType {
  return typeof value === "string" && Object.hasOwn(PAYMENT_TYPE_NAMES, value)
}

function shapeRefusal(sent: AdjustmentInput | undefined): AdjustmentRefusal | null {
  // Whatever arrived, read field by field.
  const input = (sent ?? {}) as Record<string, unknown>
  if (!isAdjustmentReason(input.reason) || typeof input.void !== "boolean") return adjustmentRefusal("invalid_reason")
  if (input.note !== null && typeof input.note !== "string") return adjustmentRefusal("note_too_long")
  if (input.void) return null
  if (!isRecordedType(input.type)) return adjustmentRefusal("invalid_type")
  if (input.amount !== null && (typeof input.amount !== "number" || !Number.isFinite(input.amount))) {
    return adjustmentRefusal("amount_not_positive")
  }
  if (typeof input.paidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) return adjustmentRefusal("date_missing")
  return null
}

// Adjusts or voids a payment. Allowed on a closed lead: an adjustment
// corrects history. `leadId` is the lead screen to refresh; `requestId` is
// the form's id for this adjustment, the same on every retry.
export async function adjustSchoolFeePayment(
  leadId: string,
  paymentId: string,
  input: AdjustmentInput,
  requestId: string,
): Promise<AdjustPaymentOutcome> {
  if (typeof leadId !== "string" || typeof paymentId !== "string") return adjustmentRefusal("not_found")
  const refused = shapeRefusal(input)
  if (refused) return refused
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return adjustmentRefusal("unavailable")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "payments.record")
  if (!allowed.ok) return adjustmentRefusal("forbidden")

  const note = input.note?.trim() ? input.note.trim() : null
  const adjustment: AdjustmentInput = input.void
    ? { reason: input.reason, void: true, note }
    : { reason: input.reason, void: false, type: input.type, amount: input.amount, paidOn: input.paidOn, note }
  const adjusted = await adjustPayment(supabase, paymentId, adjustment, requestId)
  if (!adjusted.ok) return adjustmentRefusal(adjusted.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return adjustedPaymentOutcome(adjusted.data, input.void)
}
