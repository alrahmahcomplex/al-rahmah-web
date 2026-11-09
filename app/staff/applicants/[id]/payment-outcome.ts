import type { PaymentError, PaymentPreview, RecordablePaymentType, RecordedPayment } from "@/lib/services/school-fee-payments"

import { formatShillings } from "../../fees/format"

// What Record payment is told after Review and after Confirm. A refusal
// names the field it is about, so the form can mark it. The codes never
// reach the screen.

export type PaymentField = "type" | "amount" | "paid_on"

export type PaymentRefusal = { status: "refused"; field: PaymentField | null; message: string }

export type PreviewOutcome = { status: "preview"; preview: PaymentPreview } | PaymentRefusal

export type RecordPaymentOutcome = { status: "recorded"; message: string } | PaymentRefusal

// A Pre-Form One fee leaves Total paid and the Seat priority alone, so its
// confirmation says so instead of repeating them.
export function recordedPaymentOutcome({ totalPaid, priority }: RecordedPayment, type?: RecordablePaymentType): RecordPaymentOutcome {
  if (type === "pre_form_one_fee") {
    return { status: "recorded", message: "Pre-Form One fee recorded. It doesn't count toward the School fee or Seat priority." }
  }
  const seat = priority === null ? "No Seat priority yet." : `Seat priority: ${priority}.`
  return { status: "recorded", message: `Payment recorded. Total paid is TZS ${formatShillings(totalPaid)}. ${seat}` }
}

// The warning on the review when the payment would give the lead a seat in a
// class already at or over capacity, or null. Recording still goes ahead.
export function overfillWarning({ wouldOverfill, seats, seatsTaken }: PaymentPreview): string | null {
  if (!wouldOverfill || seats === null) return null
  const set = `${seats} ${seats === 1 ? "seat" : "seats"}`
  return (
    `This lead's class is full: ${set}, ${seatsTaken} taken. This payment gives the lead a Seat priority, so the ` +
    "class will have more leads than seats. You can still record it; tell the Admissions Manager."
  )
}

// `doing` finishes "The payment could not be …" when the database is out of
// reach.
export function paymentRefusal(error: PaymentError, doing: "checked" | "recorded"): PaymentRefusal {
  switch (error) {
    case "lead_closed":
      return {
        status: "refused",
        field: null,
        message: "This lead is closed, so it can't take payments. A Reopening request must be approved first.",
      }
    case "not_passed":
      return {
        status: "refused",
        field: null,
        message:
          "Payments can be recorded only once the lead's current interview result is Passed, or a reopening approved it to enrol without a retaken interview.",
      }
    case "no_schedule":
      return {
        status: "refused",
        field: null,
        message: "This lead's enrollment year has no Fee schedule yet, so no payment can be recorded against it.",
      }
    case "invalid_type":
      return { status: "refused", field: "type", message: "Choose the payment type." }
    case "not_waivable":
      return {
        status: "refused",
        field: "type",
        message: "Fee waived can be recorded only while the lead has a granted Qualified orphan discount.",
      }
    case "amount_not_allowed":
      return { status: "refused", field: "amount", message: "Fee waived has no amount. Leave the amount empty." }
    case "already_waived":
      return { status: "refused", field: "type", message: "This lead's fee is already waived." }
    case "not_pre_form_one":
      return {
        status: "refused",
        field: "type",
        message: "A Pre-Form One fee can be recorded only while the Pre-Form One programme is ticked on a FORM 1 lead.",
      }
    case "amount_not_positive":
      return { status: "refused", field: "amount", message: "Enter an amount above zero." }
    case "amount_not_whole":
      return { status: "refused", field: "amount", message: "Enter the amount in whole shillings, with no cents." }
    case "amount_too_large":
      return { status: "refused", field: "amount", message: "This amount is too large to be a payment. Check it and enter it again." }
    case "date_missing":
      return { status: "refused", field: "paid_on", message: "Enter the payment date." }
    case "date_in_future":
      return { status: "refused", field: "paid_on", message: "The payment date can't be later than today." }
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't record school-fee payments." }
    case "not_found":
      return { status: "refused", field: null, message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return {
        status: "refused",
        field: null,
        message:
          doing === "recorded"
            ? "The payment could not be recorded. Nothing was saved. Try again in a moment."
            : "The payment could not be checked. Nothing was saved. Try again in a moment.",
      }
  }
}
