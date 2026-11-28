// What the public Admission form reads after it is up: this year's
// application count, the standard interview discount and the range of
// savings the codes that work today give, from /api/apply/live. Shared
// by the route and the browser hook, so it imports nothing from the server.

/**
 * The smallest application count the form states. A small number undermines
 * the sentence ("we already have 12 applications" reads as few, not many), so
 * below 100 the form leaves the sentence out and the rest of the offer copy
 * stands. Owner-informed decision, 2026-11-09.
 */
export const MIN_SHOWN_APPLICATIONS = 100

/**
 * The route's answer. A field is null when it could not be read. `lowest`
 * and `highest` are the smallest and largest saving a working code gives
 * now: both 0 when no code gives one, and both null when the read failed.
 */
export type LiveApply = { applications: number | null; discount: number | null; lowest: number | null; highest: number | null }

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
