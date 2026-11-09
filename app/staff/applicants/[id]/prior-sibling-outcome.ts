import type { SetPriorSiblingError } from "@/lib/services/sibling-discount"

// What the prior-sibling tick on the discount panel says (#113). The fees
// module's codes never reach the screen.

export const PRIOR_SIBLING_LABEL = "Has a sibling already at Al-Rahmah"

export const PRIOR_SIBLING_HINT = "For an older brother or sister who enrolled before the system. The Sibling discount then applies."

export type PriorSiblingOutcome = { status: "done" } | { status: "refused"; field: "name" | "class" | null; message: string }

export function priorSiblingOutcome(error: SetPriorSiblingError): PriorSiblingOutcome {
  switch (error) {
    case "forbidden":
      return { status: "refused", field: null, message: "Your role can't change the sibling tick. Nothing was saved." }
    case "invalid-name":
      return { status: "refused", field: "name", message: "Write the sibling's name, in at most 200 characters." }
    case "invalid-class":
      return { status: "refused", field: "class", message: "Choose the sibling's class." }
    case "lead-closed":
      return { status: "refused", field: null, message: "This lead is closed, so the sibling tick can't change. Reload the page." }
    case "not-found":
      return { status: "refused", field: null, message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", field: null, message: "The sibling tick could not be saved. Nothing was changed. Try again in a moment." }
  }
}
