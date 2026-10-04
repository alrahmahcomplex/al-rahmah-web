"use server"

import { revalidatePath } from "next/cache"

import { isPaymentType, previewPayment, recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import {
  paymentRefusal,
  recordedPaymentOutcome,
  type PaymentRefusal,
  type PreviewOutcome,
  type RecordPaymentOutcome,
} from "./payment-outcome"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

function shapeRefusal(leadId: unknown, input: Partial<PaymentInput> | undefined): PaymentRefusal | null {
  if (typeof leadId !== "string") return paymentRefusal("not_found", "checked")
  if (!isPaymentType(input?.type)) return paymentRefusal("invalid_type", "checked")
  if (typeof input.amount !== "number" || !Number.isFinite(input.amount)) return paymentRefusal("amount_not_positive", "checked")
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

  const preview = await previewPayment(supabase, leadId, { type: input.type, amount: input.amount, paidOn: input.paidOn })
  if (!preview.ok) return paymentRefusal(preview.error, "checked")
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

  const recorded = await recordPayment(
    supabase,
    leadId,
    { type: input.type, amount: input.amount, paidOn: input.paidOn },
    requestId,
  )
  if (!recorded.ok) return paymentRefusal(recorded.error, "recorded")
  revalidatePath(`/staff/leads/${leadId}`)
  return recordedPaymentOutcome(recorded.data)
}
