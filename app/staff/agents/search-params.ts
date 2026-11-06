import type { AccountFilter } from "@/lib/services/agent-account-list"
import type { BatchOutcome } from "@/lib/services/agent-invite-batches"
import type { AgentFilter } from "@/lib/services/marketing-agents"

// The Marketing Agents screen keeps its filter, search, import and page in
// the URL (status, account, q, import, page), so the back button and a
// shared link show the same list. An account-state filter (#191) shows the
// agents in that state in place of the status filter's list. An invite
// batch's count (#192, batch and outcome) shows the agents behind it.

type SearchParams = { [key: string]: string | string[] | undefined }

export type AgentScreenSearch = {
  status: AgentFilter
  account?: AccountFilter
  query?: string
  importBatchId?: string
  // An invite batch, and the count whose agents the list shows.
  batchId?: string
  batchOutcome?: BatchOutcome
  page: number
}

const ACCOUNT_PARAMS: Record<string, AccountFilter> = {
  "awaiting-confirmation": "awaiting_confirmation",
  "no-account": "no_account",
  "invite-not-sent": "invite_not_sent",
  "link-expired": "invite_expired",
}
const ACCOUNT_PARAM_FOR: Record<AccountFilter, string> = {
  awaiting_confirmation: "awaiting-confirmation",
  no_account: "no-account",
  invite_not_sent: "invite-not-sent",
  invite_expired: "link-expired",
}

const OUTCOME_PARAMS: Record<string, BatchOutcome> = { sent: "sent", waiting: "waiting", "no-email": "no_email", failed: "failed" }
const OUTCOME_PARAM_FOR: Record<BatchOutcome, string> = { sent: "sent", waiting: "waiting", no_email: "no-email", failed: "failed" }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  const batchId = first(params.batch)?.trim()
  const batchOutcome = OUTCOME_PARAMS[first(params.outcome) ?? ""]
  const batch = batchId && UUID.test(batchId) ? { batchId, batchOutcome } : {}
  return {
    status: STATUS_PARAMS[first(params.status) ?? ""] ?? defaultAgentFilter(canApprove),
    account: ACCOUNT_PARAMS[first(params.account) ?? ""],
    query,
    importBatchId,
    ...batch,
    page: Number.isInteger(page) && page > 0 && page <= LAST_PAGE ? page : 1,
  }
}

// The URL of a search, with some of it changed. The page is left out on the
// first page; the status is always written, so the link means the same to
// everyone it is shared with.
export function agentsHref(search: AgentScreenSearch, changes: Partial<AgentScreenSearch> = {}) {
  const { status, account, query, importBatchId, batchId, batchOutcome, page } = { ...search, ...changes }
  const params = new URLSearchParams()
  params.set("status", PARAM_FOR[status])
  if (account) params.set("account", ACCOUNT_PARAM_FOR[account])
  if (query) params.set("q", query)
  if (importBatchId) params.set("import", importBatchId)
  if (batchId) params.set("batch", batchId)
  if (batchId && batchOutcome) params.set("outcome", OUTCOME_PARAM_FOR[batchOutcome])
  if (page > 1) params.set("page", String(page))
  return `/staff/agents?${params.toString()}`
}

export const statusParam = (status: AgentFilter) => PARAM_FOR[status]
export const accountParam = (account: AccountFilter) => ACCOUNT_PARAM_FOR[account]
export const outcomeParam = (outcome: BatchOutcome) => OUTCOME_PARAM_FOR[outcome]
