import type { AccountFilter } from "@/lib/services/agent-account-list"
import type { AgentFilter } from "@/lib/services/marketing-agents"

// The Marketing Agents screen keeps its filter, search, import and page in
// the URL (status, account, q, import, page), so the back button and a
// shared link show the same list. An account-state filter (#191) shows the
// agents in that state in place of the status filter's list.

type SearchParams = { [key: string]: string | string[] | undefined }

export type AgentScreenSearch = {
  status: AgentFilter
  account?: AccountFilter
  query?: string
  importBatchId?: string
  page: number
}

const ACCOUNT_PARAMS: Record<string, AccountFilter> = {
  "invite-not-sent": "invite_not_sent",
  "link-expired": "invite_expired",
  "awaiting-confirmation": "awaiting_confirmation",
}
const ACCOUNT_PARAM_FOR: Record<AccountFilter, string> = {
  invite_not_sent: "invite-not-sent",
  invite_expired: "link-expired",
  awaiting_confirmation: "awaiting-confirmation",
}

const STATUS_PARAMS: Record<string, AgentFilter> = { pending: "Pending", approved: "Approved", retired: "Retired", all: "all" }
const PARAM_FOR: Record<AgentFilter, string> = { Pending: "pending", Approved: "approved", Retired: "retired", all: "all" }

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
  const importBatchId = first(params.import)?.trim() || undefined
  const page = Number(first(params.page))
  return {
    status: STATUS_PARAMS[first(params.status) ?? ""] ?? defaultAgentFilter(canApprove),
    account: ACCOUNT_PARAMS[first(params.account) ?? ""],
    query,
    importBatchId,
    page: Number.isInteger(page) && page > 0 && page <= LAST_PAGE ? page : 1,
  }
}

// The URL of a search, with some of it changed. The page is left out on the
// first page; the status is always written, so the link means the same to
// everyone it is shared with.
export function agentsHref(search: AgentScreenSearch, changes: Partial<AgentScreenSearch> = {}) {
  const { status, account, query, importBatchId, page } = { ...search, ...changes }
  const params = new URLSearchParams()
  params.set("status", PARAM_FOR[status])
  if (account) params.set("account", ACCOUNT_PARAM_FOR[account])
  if (query) params.set("q", query)
  if (importBatchId) params.set("import", importBatchId)
  if (page > 1) params.set("page", String(page))
  return `/staff/agents?${params.toString()}`
}

export const statusParam = (status: AgentFilter) => PARAM_FOR[status]
export const accountParam = (account: AccountFilter) => ACCOUNT_PARAM_FOR[account]
