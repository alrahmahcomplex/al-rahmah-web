import type { ApplyError } from "@/lib/services/re-application-apply"

import { correctionOutcome, type CorrectionOutcome } from "../../leads/[id]/correction-outcome"

// What Apply is told after it asks: the lead screen's correction outcomes,
// worded for a re-application where they differ.
export function applyOutcome(error: ApplyError): CorrectionOutcome {
  switch (error.kind) {
    case "not-differing":
      return {
        status: "refused",
        field: null,
        message: "This field matched the lead when the re-application arrived, so there is nothing to apply.",
      }
    case "not-found":
      return { status: "refused", field: null, message: "This re-application could not be found. Reload the page." }
    case "children-changed":
      return {
        status: "refused",
        field: null,
        message:
          "The children who share this parent or guardian have changed since you opened the page. Nothing was saved. Reload the page to see who the change reaches.",
      }
    default:
      return correctionOutcome(error)
  }
}
