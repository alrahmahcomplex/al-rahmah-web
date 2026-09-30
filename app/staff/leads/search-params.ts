import { CLOSURE_FILTERS, LAST_PAGE, LEAD_STATUSES, type ClosureFilter, type LeadSearch, type LeadStatus } from "@/lib/services/leads"

// The Leads screen keeps its search in the URL (q, status, closure, page), so
// a search can be bookmarked, shared and paged with the back button working.

type SearchParams = { [key: string]: string | string[] | undefined }

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

function oneOf<T extends string>(allowed: readonly T[], value: string | undefined): T | undefined {
  return (allowed as readonly string[]).includes(value ?? "") ? (value as T) : undefined
}

// What the URL asks for. Anything missing or unknown falls back to the
// everyday list: leads without a closure mark, first page.
export function parseLeadSearch(params: SearchParams): LeadSearch & { closure: ClosureFilter } {
  const query = first(params.q)?.trim() || undefined
  const page = Number(first(params.page))
  return {
    query,
    status: oneOf<LeadStatus>(LEAD_STATUSES, first(params.status)),
    closure: oneOf<ClosureFilter>(CLOSURE_FILTERS, first(params.closure)) ?? "open",
    page: Number.isInteger(page) && page > 0 && page <= LAST_PAGE ? page : 1,
  }
}

// The URL of a search, with some of it changed. Defaults are left out.
export function leadsHref(search: LeadSearch, changes: Partial<LeadSearch> = {}) {
  const { query, status, closure, page } = { ...search, ...changes }
  const params = new URLSearchParams()
  if (query) params.set("q", query)
  if (status) params.set("status", status)
  if (closure && closure !== "open") params.set("closure", closure)
  if (page > 1) params.set("page", String(page))
  const encoded = params.toString()
  return encoded ? `/staff/leads?${encoded}` : "/staff/leads"
}
