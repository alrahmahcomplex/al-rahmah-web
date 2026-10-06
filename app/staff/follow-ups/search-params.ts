import { LAST_FOLLOW_UP_QUEUE_PAGE } from "@/lib/services/follow-ups"

// The Follow-ups screen keeps each section's page in the URL (overdue,
// upcoming), so a page can be shared and the back button pages back.

type SearchParams = { [key: string]: string | string[] | undefined }

export type FollowUpSearch = { overdue: number; upcoming: number }

function pageOf(value: string | string[] | undefined): number {
  const page = Number(Array.isArray(value) ? value[0] : value)
  return Number.isInteger(page) && page > 0 && page <= LAST_FOLLOW_UP_QUEUE_PAGE ? page : 1
}

// Each section's page; anything unreadable means the first page.
export function parseFollowUpSearch(params: SearchParams): FollowUpSearch {
  return { overdue: pageOf(params.overdue), upcoming: pageOf(params.upcoming) }
}

// The screen's URL with a section's page changed. First pages are left out.
export function followUpsHref(search: FollowUpSearch, changes: Partial<FollowUpSearch> = {}): string {
  const { overdue, upcoming } = { ...search, ...changes }
  const params = new URLSearchParams()
  if (overdue > 1) params.set("overdue", String(overdue))
  if (upcoming > 1) params.set("upcoming", String(upcoming))
  const query = params.toString()
  return query ? `/staff/follow-ups?${query}` : "/staff/follow-ups"
}
