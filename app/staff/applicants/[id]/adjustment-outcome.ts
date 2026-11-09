import type { AdjustedPayment, AdjustmentError } from "@/lib/services/payment-adjustments"

import { formatShillings } from "../../fees/format"

// What Adjust is told after Save. A refusal names the field it is about, so
// the form can mark it. The codes never reach the screen.

export type AdjustmentField = "reason" | "type" | "amount" | "paid_on" | "note"

export type AdjustmentRefusal = { status: "refused"; field: AdjustmentField | null; message: string }

export type AdjustPaymentOutcome = { status: "adjusted"; message: string } | AdjustmentRefusal

export function adjustedPaymentOutcome({ totalPaid, priority }: AdjustedPayment, voided: boolean): AdjustPaymentOutcome {
  const seat = priority === null ? "No Seat priority." : `Seat priority: ${priority}.`
  const done = voided ? "Payment voided." : "Adjustment saved."
  return { status: "adjusted", message: `${done} Total paid is TZS ${formatShillings(totalPaid)}. ${seat}` }
}

export function adjustmentRefusal(error: AdjustmentError): AdjustmentRefusal {
  switch (error) {
    case "invalid_reason":
      return { status: "refused", field: "reason", message: "Choose a reason for the adjustment." }
    case "void_needs_duplicate":
      return { status: "refused", field: "reason", message: "Only Duplicate entry can void a payment." }
    case "duplicate_needs_void":
      return {
        status: "refused",
        field: "reason",
        message: "Duplicate entry voids the payment. To correct it instead, choose another reason.",
      }
    case "restore_needs_correction":
      return {
        status: "refused",
        field: "reason",
        message: "This payment is void. To bring it back, choose Data-entry correction.",
      }
    case "invalid_type":
      return { status: "refused", field: "type", message: "Choose the payment type." }
    case "type_to_fee_waived":
      return { status: "refused", field: "type", message: "A payment can't be changed to Fee waived." }
    case "type_from_fee_waived":
      return { status: "refused", field: "type", message: "A Fee waived payment keeps its type." }
    case "already_waived":
      return {
        status: "refused",
        field: "reason",
        message: "This lead already has a Fee waived payment that counts, so this one can't be restored.",
      }
    case "type_pre_form_one":
      return {
        status: "refused",
        field: "type",
        message: "A payment can't move between the School fee and the Pre-Form One fee.",
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
    case "note_too_long":
      return { status: "refused", field: "note", message: "Keep the note to 1,000 characters or fewer." }
    case "unchanged":
      return {
        status: "refused",
        field: null,
        message: "This says what the payment already says. Change the type, amount or date, or cancel.",
      }
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't adjust school-fee payments." }
    case "not_found":
      return { status: "refused", field: null, message: "This payment could not be found. Reload the page." }
    case "unavailable":
      return {
        status: "refused",
        field: null,
        message: "The adjustment could not be saved. Nothing was changed. Try again in a moment.",
      }
  }
}
