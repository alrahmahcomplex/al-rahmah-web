import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { AccountState } from "./agent-invites"
import { agentSearchPatterns, AGENTS_PER_PAGE, type AgentList, type AgentStatus } from "./marketing-agents"
import type { Result } from "./result"

// The Agents screen's account-state filters (#191): one page of the agents in
// one account state, filtered by the account_state column the database
// computes. Same rows and order as the Approved list in marketing-agents.ts
// (which the agent-record tickets own): the latest approval first. Agents in
// these states are never switched off or retired, so no status note applies.

// The states the screen filters on.
export const ACCOUNT_FILTERS = ["invite_not_sent", "invite_expired", "awaiting_confirmation"] as const satisfies readonly AccountState[]
export type AccountFilter = (typeof ACCOUNT_FILTERS)[number]

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

const COLUMNS = "id, full_name, phone, whatsapp, code, status, registered_at, approved_at, lead_count"

export async function listAgentsInAccountState(
  supabase: SupabaseClient,
  state: AccountFilter,
  search: { query?: string; page: number },
): Promise<Result<AgentList, "unavailable">> {
  const page = Number.isInteger(search.page) && search.page > 0 ? search.page : 1
  const patterns = agentSearchPatterns(search.query ?? "")

  const build = (head = false) => {
    let list = supabase
      .from("marketing_agents")
      .select(COLUMNS, { count: "exact", head })
      .is("retired_at", null)
      .eq("account_state", state)
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
    console.error("Could not list agents by account state", error)
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
