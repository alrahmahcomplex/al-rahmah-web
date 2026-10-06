import type { ReApplicationFilter } from "@/lib/services/re-applications"

// The Re-applications screen keeps its filter and page in the URL (reviewed,
// page), so the back button and a shared link show the same list.

type SearchParams = { [key: string]: string | string[] | undefined }

export type ReApplicationSearch = { filter: ReApplicationFilter; page: number }

// Far past any real list, and small enough to stay a safe range offset.
const LAST_PAGE = 10_000

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

export function parseReApplicationSearch(params: SearchParams): ReApplicationSearch {
  const page = Number(first(params.page))
  return {
    filter: first(params.reviewed) === "1" ? "reviewed" : "unreviewed",
    page: Number.isInteger(page) && page > 0 && page <= LAST_PAGE ? page : 1,
  }
}

// The URL of a search, with some of it changed. The queue of unreviewed ones
// and the first page are left out.
export function reApplicationsHref(search: ReApplicationSearch, changes: Partial<ReApplicationSearch> = {}) {
  const { filter, page } = { ...search, ...changes }
  const params = new URLSearchParams()
  if (filter === "reviewed") params.set("reviewed", "1")
  if (page > 1) params.set("page", String(page))
  const query = params.toString()
  return query ? `/staff/re-applications?${query}` : "/staff/re-applications"
}
