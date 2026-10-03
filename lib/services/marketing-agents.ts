import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The marketing-agent module: every read and write of Marketing Agents goes
// through here. Writes are database functions that check the permission
// themselves; reads rely on row-level security, which shows the agent list
// only to staff who may view leads. Codes are normalized and generated in the
// database only, so every path treats them the same.

export const AGENT_STATUSES = ["Pending", "Approved"] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]
export type AgentFilter = AgentStatus | "all"

export const AGENTS_PER_PAGE = 50

export type MarketingAgent = {
  id: string
  fullName: string
  // Normalized, such as +255700000401.
  phone: string
  whatsapp: string | null
  code: string
  status: AgentStatus
  registeredAt: string
  approvedAt: string | null
  // The approving staff member's name, looked up now. Null while Pending.
  approvedBy: string | null
}

export type AgentList = {
  agents: MarketingAgent[]
  total: number
  page: number
  pageCount: number
}

export type AgentListSearch = {
  // Left out, every agent.
  status?: AgentFilter
  query?: string
  page: number
}

export type NewAgent = { fullName: string; phone: string; whatsapp?: string | null }
export type AgentField = "full_name" | "phone" | "whatsapp"
export type RegisterAgentError = { kind: "invalid"; field: AgentField } | { kind: "unavailable" }
export type ApproveAgentError = "forbidden" | "not-found" | "no-change" | "unavailable"

const AGENT_FIELDS = new Set<string>(["full_name", "phone", "whatsapp"])

function refusedField(details: string | null | undefined): AgentField | null {
  try {
    const field = JSON.parse(details ?? "")?.field
    return typeof field === "string" && AGENT_FIELDS.has(field) ? (field as AgentField) : null
  } catch {
    return null
  }
}

// Registers a Marketing Agent and returns their code. Takes the secret-key
// client: only the server may register, after its own checks. A phone that
// already holds an agent returns that agent's code unchanged, so a retry
// after a dropped connection never makes a second agent.
export async function registerAgent(
  supabase: SupabaseClient,
  agent: NewAgent,
): Promise<Result<{ code: string }, RegisterAgentError>> {
  const { data, error } = await supabase.rpc("register_marketing_agent", {
    full_name: agent.fullName,
    phone: agent.phone,
    whatsapp: agent.whatsapp ?? null,
  })
  if (error) {
    if (error.message === "invalid") {
      const field = refusedField(error.details)
      if (field) return { ok: false, error: { kind: "invalid", field } }
    }
    console.error("Could not register a Marketing Agent", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  return { ok: true, data: { code: data as string } }
}

type AgentRow = {
  id: string
  full_name: string
  phone: string
  whatsapp: string | null
  code: string
  status: AgentStatus
  registered_at: string
  approved_at: string | null
}

const AGENT_COLUMNS = "id, full_name, phone, whatsapp, code, status, registered_at, approved_at"

// The search box's patterns, matched against the agent's search text: the
// name in lowercase, the code, and both numbers as digits only. A query that
// reads as a phone number also matches by its digits, however it was typed:
// 0700 000 401, +255 700 000 401 and 700000401 all find +255700000401.
export function agentSearchPatterns(query: string): string[] {
  // Only characters a name, code or phone holds, so nothing in the query
  // can act as a pattern or filter character.
  const text = query
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'+.-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!text) return []
  const patterns = [text]
  if (/^[+\d\s().-]+$/.test(text)) {
    const digits = text.replace(/\D/g, "").replace(/^0+/, "")
    if (digits.length >= 3 && digits !== text) patterns.push(digits)
  }
  return patterns
}

// One page of agents. Pending is oldest first, the order they are approved
// in; Approved is the latest approval first; All is the latest registration
// first. Staff without leads.view read an empty list.
export async function listAgents(
  supabase: SupabaseClient,
  search: AgentListSearch,
): Promise<Result<AgentList, "unavailable">> {
  const page = Number.isInteger(search.page) && search.page > 0 ? search.page : 1
  const patterns = agentSearchPatterns(search.query ?? "")
  const status = search.status ?? "all"

  const build = (head = false) => {
    let list = supabase.from("marketing_agents").select(AGENT_COLUMNS, { count: "exact", head })
    if (status !== "all") list = list.eq("status", status)
    if (patterns.length > 0) {
      list = list.or(patterns.map((pattern) => `search_text.ilike."*${pattern}*"`).join(","))
    }
    if (status === "Pending") return list.order("registered_at", { ascending: true }).order("id")
    if (status === "Approved") return list.order("approved_at", { ascending: false }).order("id")
    return list.order("registered_at", { ascending: false }).order("id")
  }

  const from = (page - 1) * AGENTS_PER_PAGE
  let { data, count, error } = await build()
    .range(from, from + AGENTS_PER_PAGE - 1)
    .overrideTypes<AgentRow[], { merge: false }>()
  // PostgREST refuses a range past the last row. That page is empty, and a
  // count alone still says how many pages there are.
  if (error?.code === "PGRST103") {
    ;({ count, error } = await build(true))
    data = []
  }
  if (error) {
    console.error("Could not list Marketing Agents", error)
    return { ok: false, error: "unavailable" }
  }

  const rows = data ?? []
  const approvedIds = rows.filter((row) => row.status === "Approved").map((row) => row.id)
  const approvers = new Map<string, string>()
  if (approvedIds.length > 0) {
    const names = await supabase.rpc("marketing_agent_approvers", { agent_ids: approvedIds })
    if (names.error) {
      console.error("Could not read who approved the Marketing Agents", names.error)
      return { ok: false, error: "unavailable" }
    }
    for (const row of names.data as { agent_id: string; approver_name: string }[]) {
      approvers.set(row.agent_id, row.approver_name)
    }
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
      })),
    },
  }
}

// Approves a Pending agent, recording the approver and the time. Needs
// agents.approve and nothing else. Approval is one-way: an agent already
// Approved is refused as `no-change`.
export async function approveAgent(
  supabase: SupabaseClient,
  agentId: string,
): Promise<Result<null, ApproveAgentError>> {
  const { error } = await supabase.rpc("approve_marketing_agent", { agent_id: agentId })
  if (error) {
    if (error.message === "not_permitted") return { ok: false, error: "forbidden" }
    if (error.message === "not_found") return { ok: false, error: "not-found" }
    if (error.message === "no_change") return { ok: false, error: "no-change" }
    // A malformed id is no agent at all.
    if (error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not approve a Marketing Agent", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: null }
}

// How many agents wait for approval. Zero for staff without leads.view,
// who can't read the list.
export async function getPendingAgentCount(supabase: SupabaseClient): Promise<Result<number, "unavailable">> {
  const { count, error } = await supabase
    .from("marketing_agents")
    .select("id", { count: "exact", head: true })
    .eq("status", "Pending")
  if (error) {
    console.error("Could not count the Pending Marketing Agents", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: count ?? 0 }
}
