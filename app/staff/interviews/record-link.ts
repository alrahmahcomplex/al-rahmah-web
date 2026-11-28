import { interviewsHref, parseBoard, parseYear } from "./board"

// View full record in the Interviews side sheet opens the student's record on
// its Interview tab, carrying the list it came from in `from`, so the record's
// title can read "Interviews › name" and lead back to that same list.

/** The record's address from the Interviews list at `listHref`. */
export function recordFromInterviews(leadId: string, listHref: string): string {
  const query = listHref.split("?")[1] ?? ""
  return `/staff/applicants/${leadId}?tab=interview&from=${encodeURIComponent(query || "interviews")}`
}

/**
 * The list to go back to, read from the record's `from`; null when the record
 * was not opened from Interviews. Only what parseBoard reads survives, so the
 * link can lead nowhere but the Interviews list.
 */
export function interviewsBackHref(from: string | string[] | undefined): string | null {
  const text = Array.isArray(from) ? from[0] : from
  if (!text) return null
  const params = new URLSearchParams(text)
  const year = parseYear(params.get("year") ?? undefined)
  if (year === undefined) return "/staff/interviews"
  return interviewsHref(year, { ...parseBoard(params), open: null })
}
