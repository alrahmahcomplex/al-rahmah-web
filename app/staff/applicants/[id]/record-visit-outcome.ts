import type { RecordVisitError } from "@/lib/services/leads"

import { correctionOutcome, type CorrectionOutcome } from "./correction-outcome"

// Turns what the lead module refused when recording a visit into what the
// Record visit form shows. Refusals it shares with the corrections read the
// same way.
export function recordVisitOutcome(error: RecordVisitError): CorrectionOutcome {
  switch (error.kind) {
    case "not-applied":
      return {
        status: "refused",
        field: null,
        message: "This applicant is no longer Applied, so their visit is already recorded. Reload the page to see it.",
      }
    case "closed":
      return { status: "refused", field: null, message: "This application is closed, so the visit can't be recorded." }
    default:
      return correctionOutcome(error)
  }
}
