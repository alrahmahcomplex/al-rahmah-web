// What the public Admission form reads after it is up: this year's
// application count and the interview discount, from /api/apply/live. Shared
// by the route and the browser hook, so it imports nothing from the server.

/**
 * The smallest application count the form states. A small number undermines
 * the sentence ("we already have 12 applications" reads as few, not many), so
 * below 100 the form leaves the sentence out and the rest of the offer copy
 * stands. Owner-informed decision, 2026-11-09.
 */
export const MIN_SHOWN_APPLICATIONS = 100

/** The route's answer. Either field is null when it could not be read. */
export type LiveApply = { applications: number | null; discount: number | null }

/** Where the form reads it. */
export const LIVE_APPLY_PATH = "/api/apply/live"

/** How often an open, visible form reads it again. */
export const LIVE_APPLY_POLL_MS = 30_000

/** The count the form states, or null when it is unknown or below the minimum. */
export function shownApplicationCount(count: number | null): number | null {
  if (count === null || count < MIN_SHOWN_APPLICATIONS) return null
  return count
}

/** A count with thousands grouped, as "1,284". */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("en-US").format(n)
}
