"use server"

import { revalidatePath } from "next/cache"

import { isRecordablePaymentType, previewPayment, recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { requirePermission } from "@/lib/services/staff-auth"
import { getSeatMode } from "@/lib/services/streams"
import { createClient } from "@/utils/supabase/server"

import {
  paymentRefusal,
  recordedPaymentOutcome,
  type PaymentRefusal,
  type PreviewOutcome,
  type RecordPaymentOutcome,
} from "./payment-outcome"
import { noClassRefusal, seatAfter, seatBefore } from "./seat-reads"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

function shapeRefusal(leadId: unknown, input: Partial<PaymentInput> | undefined): PaymentRefusal | null {
  if (typeof leadId !== "string") return paymentRefusal("not_found", "checked")
  if (!isRecordablePaymentType(input?.type)) return paymentRefusal("invalid_type", "checked")
  // Fee waived has no amount; every other type has a number.
  if (input.type === "fee_waived") {
    if (input.amount !== null) return paymentRefusal("amount_not_allowed", "checked")
  } else if (typeof input.amount !== "number" || !Number.isFinite(input.amount)) {
    return paymentRefusal("amount_not_positive", "checked")
  }
  if (typeof input.paidOn !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(input.paidOn)) {
    return paymentRefusal("date_missing", "checked")
  }
  return null
}

// What recording the payment would do. Records nothing.
export async function previewSchoolFeePayment(leadId: string, input: PaymentInput): Promise<PreviewOutcome> {
  const refused = shapeRefusal(leadId, input)
  if (refused) return refused

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "payments.record")
  if (!allowed.ok) return paymentRefusal("forbidden", "checked")

  const preview = await previewPayment(supabase, leadId, { type: input.type, amount: input.amount ?? null, paidOn: input.paidOn })
  if (!preview.ok) {
    return preview.error === "no_class" ? noClassRefusal(supabase, leadId, "checked") : paymentRefusal(preview.error, "checked")
  }
  // Once streams are on, the old seat count says nothing, so its warning goes.
  if (preview.data.wouldOverfill && (await getSeatMode(supabase)) === "named") {
    return { status: "preview", preview: { ...preview.data, wouldOverfill: false } }
  }
  return { status: "preview", preview: preview.data }
}

const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Records the payment the Accountant confirmed. `requestId` is the form's id
// for this payment, the same on every retry.
export async function recordSchoolFeePayment(
  leadId: string,
  input: PaymentInput,
  requestId: string,
): Promise<RecordPaymentOutcome> {
  const refused = shapeRefusal(leadId, input)
  if (refused) return refused
  if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) return paymentRefusal("unavailable", "recorded")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "payments.record")
  if (!allowed.ok) return paymentRefusal("forbidden", "recorded")

  const before = await seatBefore(supabase, leadId, input.type)
  const recorded = await recordPayment(
    supabase,
    leadId,
    { type: input.type, amount: input.amount ?? null, paidOn: input.paidOn },
    requestId,
  )
  if (!recorded.ok) {
    return recorded.error === "no_class" ? noClassRefusal(supabase, leadId, "recorded") : paymentRefusal(recorded.error, "recorded")
  }
  revalidatePath(`/staff/applicants/${leadId}`)
  const outcome = recordedPaymentOutcome(recorded.data, input.type)
  const seat = await seatAfter(supabase, leadId, before, input.amount ?? null)
  return seat && outcome.status === "recorded" ? { ...outcome, seat } : outcome
}
