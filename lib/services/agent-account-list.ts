import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { BatchOutcome } from "./agent-invite-batches"
import type { AccountState } from "./agent-invites"
import { agentSearchPatterns, AGENTS_PER_PAGE, UUID, type AgentList, type AgentStatus } from "./marketing-agents"
import type { Result } from "./result"

// The Agents screen's account-state filters (#191) and an invite batch's
// counts (#192): one page of the agents in one account state, filtered by the
// account_state column the database computes, within one import when the
// screen shows one; or one page of the agents behind one of a batch's counts.
// Same rows and order as the Approved list in marketing-agents.ts (which the
// agent-record tickets own): the latest approval first. Agents in these
// lists are never switched off or retired, so no status note applies.

// The states each filter shows. "Approved, no account yet" is every Approved
// agent who hasn't joined. Awaiting email confirmation joins them with
// claiming (#193), which is what produces it.
const FILTER_STATES = {
  no_account: ["no_email", "invite_not_sent", "invite_expired", "invited"],
  invite_not_sent: ["invite_not_sent"],
  invite_expired: ["invite_expired"],
} as const satisfies Record<string, readonly AccountState[]>

export const ACCOUNT_FILTERS = Object.keys(FILTER_STATES) as (keyof typeof FILTER_STATES)[]
export type AccountFilter = keyof typeof FILTER_STATES

export function accountFilterStates(filter: AccountFilter): readonly AccountState[] {
  return FILTER_STATES[filter]
}

type Row = {
  id: string
  full_name: string
  phone: string
  whatsapp: string | null
  code: string
  status: AgentStatus
  registered_at: string
  approved_at: string | null
  lead_count: number
}

// A plain string, so both sources below give the same query type.
const COLUMNS: string = "id, full_name, phone, whatsapp, code, status, registered_at, approved_at, lead_count"

type Search = { query?: string; page: number; importBatchId?: string }

function agentTable(supabase: SupabaseClient, head: boolean) {
  return supabase.from("marketing_agents").select(COLUMNS, { count: "exact", head })
}

// A query over agent rows, from the table or from a function returning them.
type AgentQuery = ReturnType<typeof agentTable>

async function pageOfAgents(
  supabase: SupabaseClient,
  base: (head: boolean) => AgentQuery,
  search: Search,
): Promise<Result<AgentList, "unavailable">> {
  const page = Number.isInteger(search.page) && search.page > 0 ? search.page : 1
  const patterns = agentSearchPatterns(search.query ?? "")

  const build = (head = false) => {
    let list = base(head)
    if (search.importBatchId !== undefined) {
      // A malformed id is no import, so no agent.
      list = UUID.test(search.importBatchId) ? list.eq("import_batch_id", search.importBatchId) : list.is("id", null)
    }
    if (patterns.length > 0) list = list.or(patterns.map((pattern) => `search_text.ilike."*${pattern}*"`).join(","))
    return list.order("approved_at", { ascending: false }).order("id")
  }

  const from = (page - 1) * AGENTS_PER_PAGE
  let { data, count, error } = await build()
    .range(from, from + AGENTS_PER_PAGE - 1)
    .overrideTypes<Row[], { merge: false }>()
  // A range past the last row: the page is empty, the count still holds.
  if (error?.code === "PGRST103") {
    ;({ count, error } = await build(true))
    data = []
  }
  if (error) {
    console.error("Could not list agents", error)
    return { ok: false, error: "unavailable" }
  }

  const rows = data ?? []
  const approvers = new Map<string, string>()
  const approvedIds = rows.filter((row) => row.status === "Approved").map((row) => row.id)
  if (approvedIds.length > 0) {
    const names = await supabase.rpc("marketing_agent_approvers", { agent_ids: approvedIds })
    if (names.error) {
      console.error("Could not read who approved the Marketing Agents", names.error)
      return { ok: false, error: "unavailable" }
    }
    for (const row of names.data as { agent_id: string; approver_name: string }[]) approvers.set(row.agent_id, row.approver_name)
  }

  const total = count ?? 0
  return {
    ok: true,
    data: {
      total,
      page,
      pageCount: Math.max(1, Math.ceil(total / AGENTS_PER_PAGE)),
      agents: rows.map((row) => ({
        id: row.id,
        fullName: row.full_name,
        phone: row.phone,
        whatsapp: row.whatsapp,
        code: row.code,
        status: row.status,
        registeredAt: row.registered_at,
        approvedAt: row.approved_at,
        approvedBy: approvers.get(row.id) ?? null,
        leadCount: row.lead_count,
        switchedOffAt: null,
        retiredAt: null,
        statusChange: null,
      })),
    },
  }
}

export async function listAgentsInAccountState(
  supabase: SupabaseClient,
  filter: AccountFilter,
  search: Search,
): Promise<Result<AgentList, "unavailable">> {
  return pageOfAgents(
    supabase,
    (head) =>
      agentTable(supabase, head)
        .is("retired_at", null)
        .in("account_state", [...FILTER_STATES[filter]]),
    search,
  )
}

// The agents behind one of a batch's counts, as its report counts them.
export async function listAgentsInBatchOutcome(
  supabase: SupabaseClient,
  batchId: string,
  outcome: BatchOutcome,
  search: Omit<Search, "importBatchId">,
): Promise<Result<AgentList, "unavailable">> {
  return pageOfAgents(
    supabase,
    (head) =>
      supabase
        .rpc("agent_invite_batch_agents", { batch_id: batchId, outcome }, { count: "exact", head })
        .select(COLUMNS) as unknown as AgentQuery,
    search,
  )
}
