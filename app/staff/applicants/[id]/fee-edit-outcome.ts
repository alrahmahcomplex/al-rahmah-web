import { LARGER_DISCOUNTS } from "@/lib/sibling-sentences"
import type { SiblingFeeEditError, SiblingFeeEditReason, SiblingFeeEditValue } from "@/lib/services/sibling-groups"
import type { DismissSiblingFeeEditError } from "@/lib/services/sibling-requests"

import type { Refused } from "./sibling-outcome"
import type { SiblingFeeFacts } from "./sibling-read"

// The Accountant's Sibling fee edit and "Leave the fee as it is" (#311):
// the words on the form and what it says when the database refuses. The
// prototype is https://claude.ai/artifact/P6NEbzyxA9JpdKjFzu6z6U (version 2).

export const FEE_EDIT_VALUES: readonly { value: SiblingFeeEditValue; label: string }[] = [
  { value: "full", label: "Full fee" },
  { value: "ten", label: "Sibling 10%" },
  { value: "automatic", label: "Back to automatic" },
]

export const FEE_EDIT_REASON_ORDER: readonly SiblingFeeEditReason[] = [
  "full_fee_sibling_not_enrolled",
  "sibling_proof_after_enrolment",
  "data_entry_correction",
]

// What a fee is: "Full fee", "Sibling 10%", or the larger discount that
// replaces the 10%.
export function feeWhy(discount: string | null): string {
  if (discount === "staff_child" || discount === "qualified_orphan") return LARGER_DISCOUNTS[discount].en
  if (discount === "sibling") return "Sibling 10%"
  return "Full fee"
}

export const NOTE_MAX = 1000

export function feeEditRefusal(error: SiblingFeeEditError, doing: "preview" | "save"): Refused {
  switch (error.kind) {
    case "unchanged":
      return { status: "refused", message: "Nothing would change." }
    case "invalid":
      return error.field === "reason"
        ? { status: "refused", message: "Choose the reason." }
        : error.field === "note"
          ? { status: "refused", field: "note", message: `Write the note in at most ${NOTE_MAX.toLocaleString("en-GB")} characters.` }
          : { status: "refused", message: "Choose the fee." }
    case "lead-closed":
      return { status: "refused", message: "This application has been closed, so it can't be changed. Reload the page." }
    case "forbidden":
      return { status: "refused", message: "Your role can't make this change." }
    case "not-found":
      return { status: "refused", message: "This application could not be found. Reload the page." }
    case "request-reused":
    case "unavailable":
      return {
        status: "refused",
        message:
          doing === "preview"
            ? "What the change would do could not be worked out. Try again in a moment."
            : "The change could not be saved. Nothing was changed. Try again in a moment.",
      }
  }
}

export function keepFeeRefusal(error: DismissSiblingFeeEditError): Refused {
  switch (error) {
    case "invalid":
      return { status: "refused", field: "note", message: "Write why the fee stays as it is." }
    case "not-needed":
      return { status: "refused", message: "This fee no longer needs a decision. Reload the page." }
    case "forbidden":
      return { status: "refused", message: "Your role can't make this change." }
    case "not-found":
      return { status: "refused", message: "This application could not be found. Reload the page." }
    default:
      return { status: "refused", message: "The change could not be saved. Nothing was changed. Try again in a moment." }
  }
}

// What follows the fee's name while a value set by hand is in force:
// "set by hand by Example Staff Two on 18 Nov 2026 · Sibling proof after
// enrolment · the note".
export function setByHandLine(fee: Pick<SiblingFeeFacts, "setByHand">): string | null {
  const s = fee.setByHand
  return s ? `set by hand by ${s.staff} on ${s.date} · ${s.reason}${s.note ? ` · ${s.note}` : ""}` : null
}
