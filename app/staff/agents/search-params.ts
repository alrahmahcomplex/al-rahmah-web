import type { AgentFilter } from "@/lib/services/marketing-agents"

// The Marketing Agents screen keeps its filter, search and page in the URL
// (status, q, page), so the back button and a shared link show the same list.

type SearchParams = { [key: string]: string | string[] | undefined }

export type AgentScreenSearch = { status: AgentFilter; query?: string; page: number }

const STATUS_PARAMS: Record<string, AgentFilter> = { pending: "Pending", approved: "Approved", all: "all" }
const PARAM_FOR: Record<AgentFilter, string> = { Pending: "pending", Approved: "approved", all: "all" }

// Far past any real list, and small enough to stay a safe range offset.
const LAST_PAGE = 10_000

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

// Approvers start on the Pending agents, the ones waiting for them. Everyone
// else starts on every agent.
export function defaultAgentFilter(canApprove: boolean): AgentFilter {
  return canApprove ? "Pending" : "all"
}

export function parseAgentSearch(params: SearchParams, canApprove: boolean): AgentScreenSearch {
  const query = first(params.q)?.trim() || undefined
  const page = Number(first(params.page))
  return {
    status: STATUS_PARAMS[first(params.status) ?? ""] ?? defaultAgentFilter(canApprove),
    query,
    page: Number.isInteger(page) && page > 0 && page <= LAST_PAGE ? page : 1,
  }
}

// The URL of a search, with some of it changed. The page is left out on the
// first page; the status is always written, so the link means the same to
// everyone it is shared with.
export function agentsHref(search: AgentScreenSearch, changes: Partial<AgentScreenSearch> = {}) {
  const { status, query, page } = { ...search, ...changes }
  const params = new URLSearchParams()
  params.set("status", PARAM_FOR[status])
  if (query) params.set("q", query)
  if (page > 1) params.set("page", String(page))
  return `/staff/agents?${params.toString()}`
}

export const statusParam = (status: AgentFilter) => PARAM_FOR[status]
