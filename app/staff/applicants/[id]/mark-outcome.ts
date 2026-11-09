import type { MarkError } from "@/lib/services/lead-closure"

// What the Mark inactive and Archive dialog is told after it sends the mark. A
// marked lead shows the closed-lead banner on the refreshed page, so success
// needs no sentence of its own.
export type MarkOutcome = { status: "marked" } | { status: "refused"; message: string }

// Turns what the lead closure module refused into a plain sentence. The codes
// never reach the screen.
export function markOutcome(error: MarkError): MarkOutcome {
  switch (error) {
    case "forbidden":
      return { status: "refused", message: "Your role can't mark leads Inactive or Archived. Nothing was changed." }
    case "invalid":
      return {
        status: "refused",
        message:
          "Choose a reason from the list, with a note of at most 1,000 characters. If the lead was marked meanwhile, reload the page to see its mark.",
      }
    case "not-found":
      return { status: "refused", message: "This lead could not be found. Reload the page." }
    case "unavailable":
      return { status: "refused", message: "The mark could not be saved. Nothing was changed. Try again in a moment." }
  }
}
