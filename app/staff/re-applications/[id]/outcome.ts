import type { MarkReviewedError } from "@/lib/services/re-applications"

// What Mark reviewed is told after it asks.
export type MarkReviewedOutcome = { status: "reviewed"; message: string } | { status: "refused"; message: string }

const REFUSED: Record<MarkReviewedError | "signed-out", string> = {
  forbidden: "You don't have permission to review re-applications.",
  "not-found": "This re-application could not be found. Reload the page and try again.",
  "no-change": "This re-application is already reviewed. Reload the page to see who reviewed it.",
  unavailable: "The re-application could not be marked reviewed just now. Try again in a moment.",
  "signed-out": "Your session has ended. Sign in again, then mark the re-application reviewed.",
}

export function markReviewedOutcome(
  result: { ok: true } | { ok: false; error: MarkReviewedError | "signed-out" },
): MarkReviewedOutcome {
  if (result.ok) return { status: "reviewed", message: "Marked reviewed." }
  return { status: "refused", message: REFUSED[result.error] }
}
