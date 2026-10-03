import type { DeclineError } from "@/lib/services/lead-closure"

// What the Decline dialog is told after it sends the decline. A declined lead
// shows the closed-lead banner on the refreshed page, so success needs no
// sentence of its own.
export type DeclineOutcome = { status: "declined" } | { status: "refused"; message: string }

// Turns what the lead closure module refused into a plain sentence. The codes
// never reach the screen.
export function declineOutcome(error: DeclineError): DeclineOutcome {
  switch (error) {
    case "forbidden":
      return { status: "refused", message: "Your role can't decline this lead with that reason. Nothing was changed." }
    case "invalid":
      return {
        status: "refused",
        message: "Choose a reason from the list. Other needs an explanation, of at most 1,000 characters.",
      }
    case "lead-closed":
      return {
        status: "refused",
        message: "This lead is already closed, so it can't be declined. Reload the page to see why.",
      }
    case "not-found":
      return { status: "refused", message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The decline could not be saved. Nothing was changed. Try again in a moment." }
  }
}
