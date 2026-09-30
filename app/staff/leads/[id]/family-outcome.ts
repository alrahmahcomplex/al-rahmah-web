import type { FamilyLinkError } from "@/lib/services/leads"

import { correctionOutcome, type CorrectionOutcome } from "./correction-outcome"

// Turns what the lead module refused when confirming, rejecting or
// separating into what the Family section shows. Refusals it shares with the
// corrections read the same way.
export function familyOutcome(error: FamilyLinkError): CorrectionOutcome {
  switch (error.kind) {
    case "no-pending-match":
      return {
        status: "refused",
        field: null,
        message: "This match has already been confirmed or rejected. Reload the page to see the Family as it is now.",
      }
    case "not-shared":
      return {
        status: "refused",
        field: null,
        message: "This child no longer shares a parent or guardian with anyone. Reload the page to see the Family as it is now.",
      }
    case "closed":
      return {
        status: "refused",
        field: null,
        message: "A child this change reaches is closed, so the Family can't be changed.",
      }
    case "children-changed":
      return {
        status: "refused",
        field: null,
        message:
          "The children who share this parent or guardian have changed since you opened the page. Nothing was changed. Reload the page to see who the change reaches.",
      }
    default:
      return correctionOutcome(error)
  }
}
