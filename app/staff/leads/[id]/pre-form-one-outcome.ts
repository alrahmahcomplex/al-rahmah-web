import type { SetPreFormOneError } from "@/lib/services/pre-form-one"

// What the Pre-Form One tick on the School fee panel says (#114). The fees
// module's codes never reach the screen.

export const PRE_FORM_ONE_LABEL = "Pre-Form One programme"

export const PRE_FORM_ONE_HINT = "Tick when the family takes up the programme before Form 1. Its fee is charged on its own."

export const PRE_FORM_ONE_NOT_APPLYING =
  "Doesn't apply: this lead's class is no longer FORM 1. The tick stays recorded, and no Pre-Form One fee can be recorded until the class is FORM 1 again."

export type PreFormOneOutcome = { status: "done" } | { status: "refused"; message: string }

export function preFormOneOutcome(error: SetPreFormOneError): PreFormOneOutcome {
  switch (error) {
    case "forbidden":
      return { status: "refused", message: "Your role can't change the Pre-Form One tick. Nothing was saved." }
    case "not-form-one":
      return { status: "refused", message: "The Pre-Form One programme is only for FORM 1 leads. Correct the class first." }
    case "lead-closed":
      return { status: "refused", message: "This lead is closed, so the Pre-Form One tick can't change. Reload the page." }
    case "not-found":
      return { status: "refused", message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The Pre-Form One tick could not be saved. Nothing was changed. Try again in a moment." }
  }
}
