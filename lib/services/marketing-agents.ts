import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { emailTakenFrom, type EmailTaken } from "@/lib/email-in-use"

import type { Result } from "./result"

// The marketing-agent module: every read and write of Marketing Agents goes
// through here. Writes are database functions that check the permission
// themselves; reads rely on row-level security, which shows the agent list
// only to staff who may view leads. Codes are normalized and generated in the
// database only, so every path treats them the same.

export const AGENT_STATUSES = ["Pending", "Approved"] as const
export type AgentStatus = (typeof AGENT_STATUSES)[number]
// Every filter but Retired leaves retired records out.
export type AgentFilter = AgentStatus | "Retired" | "all"

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
  // How many leads carry the agent's code. None for a retired record, whose
  // leads follow the code.
  leadCount: number
  // When the agent was switched off, while they are; set once retired.
  switchedOffAt: string | null
  retiredAt: string | null
  // The latest switch-off, switch-on, retirement or recreation, or null.
  statusChange: AgentStatusNote | null
  // The agent's own interview discount in whole TZS, or null when they take
  // the standard one.
  interviewDiscount: number | null
  // What the agent's code takes off the interview fee while it gives a
  // discount: the own amount, else the standard.
  discountAmount: number
}

export type AgentStatusKind = "switched_off" | "switched_on" | "retired" | "recreated"

export type AgentStatusNote = {
  kind: AgentStatusKind
  changedAt: string
  // The staff member's name, looked up now; null when the system made it.
  changedBy: string | null
  // The record that replaced a recreated one.
  replacedBy: { fullName: string; code: string } | null
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
  // Only the agents one import created (#190).
  importBatchId?: string
  page: number
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type ApproveAgentError = "forbidden" | "not-found" | "no-change" | "unavailable"

// Public registration lives in lib/services/agent-sign-up.ts (#193): the
// Discount code page signs an agent up with an email through
// sign_up_marketing_agent. The earlier register_marketing_agent is gone (#196).

type AgentRow = {
  id: string
  full_name: string
  phone: string
  whatsapp: string | null
  code: string
  status: AgentStatus
  registered_at: string
  approved_at: string | null
  lead_count: number
  switched_off_at: string | null
  retired_at: string | null
  interview_discount: number | null
  agent_discount_amount: number
}

type StatusNoteRow = {
  agent_id: string
  kind: AgentStatusKind
  changed_at: string
  changed_by_name: string | null
  replaced_by_name: string | null
  replaced_by_code: string | null
}

// lead_count and agent_discount_amount are computed columns: the database
// counts each code's leads and reads each agent's amount in the list query
// itself.
const AGENT_COLUMNS =
  "id, full_name, phone, whatsapp, code, status, registered_at, approved_at, lead_count, switched_off_at, retired_at, interview_discount, agent_discount_amount"

// The search box's patterns, matched against the agent's search text: the
// name in lowercase, the code, and both numbers as digits only. A query that
// reads as a phone number also matches by its digits, however it was typed:
// 0700 000 401, +255 700 000 401 and 700000401 all find +255700000401. A
// query that reads as a code also matches without its spaces, as the
// database's code normalizer reads it: ZNM -401 finds ZNM-401.
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
  const code = text.replace(/\s/g, "")
  if (code !== text && code.length <= 20 && /^[\p{L}\d.-]+$/u.test(code) && /\p{L}/u.test(code) && /[\d.-]/.test(code)) {
    patterns.push(code)
  }
  if (/^[+\d\s().-]+$/.test(text)) {
    const digits = text.replace(/\D/g, "").replace(/^0+/, "")
    if (digits.length >= 3 && digits !== text) patterns.push(digits)
  }
  return patterns
}

// One page of agents. Pending is oldest first, the order they are approved
// in; Approved is the latest approval first; Retired the latest retirement
// first; All is the latest registration first. Only the Retired filter shows
// retired records. Staff without leads.view read an empty list.
export async function listAgents(
  supabase: SupabaseClient,
  search: AgentListSearch,
): Promise<Result<AgentList, "unavailable">> {
  const page = Number.isInteger(search.page) && search.page > 0 ? search.page : 1
  const patterns = agentSearchPatterns(search.query ?? "")
  const status = search.status ?? "all"

  const build = (head = false) => {
    let list = supabase.from("marketing_agents").select(AGENT_COLUMNS, { count: "exact", head })
    list = status === "Retired" ? list.not("retired_at", "is", null) : list.is("retired_at", null)
    if (status === "Pending" || status === "Approved") list = list.eq("status", status)
    if (search.importBatchId !== undefined) {
      // A malformed id is no import, so no agent.
      list = UUID.test(search.importBatchId) ? list.eq("import_batch_id", search.importBatchId) : list.is("id", null)
    }
    if (patterns.length > 0) {
      list = list.or(patterns.map((pattern) => `search_text.ilike."*${pattern}*"`).join(","))
    }
    if (status === "Pending") return list.order("registered_at", { ascending: true }).order("id")
    if (status === "Approved") return list.order("approved_at", { ascending: false }).order("id")
    if (status === "Retired") return list.order("retired_at", { ascending: false }).order("id")
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

  const changedIds = rows.filter((row) => row.switched_off_at || row.retired_at).map((row) => row.id)
  const notes = new Map<string, AgentStatusNote>()
  if (changedIds.length > 0) {
    const read = await supabase.rpc("marketing_agent_status_notes", { agent_ids: changedIds })
    if (read.error) {
      console.error("Could not read the Marketing Agents' status changes", read.error)
      return { ok: false, error: "unavailable" }
    }
    for (const row of read.data as StatusNoteRow[]) {
      notes.set(row.agent_id, {
        kind: row.kind,
        changedAt: row.changed_at,
        changedBy: row.changed_by_name,
        replacedBy: row.replaced_by_name && row.replaced_by_code ? { fullName: row.replaced_by_name, code: row.replaced_by_code } : null,
      })
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
        leadCount: row.lead_count,
        switchedOffAt: row.switched_off_at,
        retiredAt: row.retired_at,
        statusChange: notes.get(row.id) ?? null,
        interviewDiscount: row.interview_discount,
        discountAmount: row.agent_discount_amount,
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

// How many agents wait for approval; a retired record waits for nothing.
// Zero for staff without leads.view, who can't read the list.
export async function getPendingAgentCount(supabase: SupabaseClient): Promise<Result<number, "unavailable">> {
  const { count, error } = await supabase
    .from("marketing_agents")
    .select("id", { count: "exact", head: true })
    .eq("status", "Pending")
    .is("retired_at", null)
  if (error) {
    console.error("Could not count the Pending Marketing Agents", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: count ?? 0 }
}

// ---------------------------------------------------------------------------
// Switching an agent off and on, and retiring them (#187).
// ---------------------------------------------------------------------------

// The Manager's three actions. Retiring is permanent: a retired record never
// changes again, gives no discount, and frees its phone for a new agent.
export const AGENT_STATUS_ACTIONS = ["switch-off", "switch-on", "retire"] as const
export type AgentStatusAction = (typeof AGENT_STATUS_ACTIONS)[number]

const ACTION_KINDS: Readonly<Record<AgentStatusAction, AgentStatusKind>> = {
  "switch-off": "switched_off",
  "switch-on": "switched_on",
  retire: "retired",
}

// A family whose interview fee the action moves: a lead carrying the code,
// open, whose current interview fee is not yet Paid. Amounts in whole TZS.
export type FeeImpactFamily = {
  leadId: string
  admissionNumber: string
  studentName: string
  className: string
  contactName: string
  contactPhone: string
  feeNow: number
  feeAfter: number
}

export type FeeImpact = { families: FeeImpactFamily[] }

// "uncertain": a change met an error it can't read as a refusal, such as a
// lost request or a gateway's reply, so it may have been saved. Only a
// change returns it.
export type AgentStatusError = "forbidden" | "not-found" | "retired" | "no-change" | "invalid-reason" | "unavailable" | "uncertain"

function kindOf(action: AgentStatusAction): AgentStatusKind | null {
  return Object.hasOwn(ACTION_KINDS, action) ? ACTION_KINDS[action] : null
}

function statusError(error: { message: string; code?: string; details?: string | null }, what: string): AgentStatusError {
  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  // A malformed id is no agent at all.
  if (error.message === "not_found" || error.code === "22P02") return "not-found"
  if (error.message === "agent_retired") return "retired"
  if (error.message === "no_change") return "no-change"
  if (error.message === "invalid") {
    try {
      if (JSON.parse(error.details ?? "")?.field === "reason") return "invalid-reason"
    } catch {
      // Not the reason, so not the caller's to fix.
    }
  }
  console.error(what, error)
  return "unavailable"
}

type FeeImpactRow = {
  lead_id: string
  admission_number: string
  student_name: string
  class_name: string
  contact_name: string
  contact_phone: string
  fee_now: number
  fee_after: number
}

function feeImpactFamily(row: FeeImpactRow): FeeImpactFamily {
  return {
    leadId: row.lead_id,
    admissionNumber: row.admission_number,
    studentName: row.student_name,
    className: row.class_name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    feeNow: row.fee_now,
    feeAfter: row.fee_after,
  }
}

// The families whose interview fee the action would move, for the dialog the
// Manager confirms. Needs agents.approve and leads.view. The database answers
// the whole list as one JSON array, read in one snapshot, so the API's row
// cap can't cut it short and no family is skipped or listed twice.
export async function getAgentFeeImpact(
  supabase: SupabaseClient,
  agentId: string,
  action: AgentStatusAction,
): Promise<Result<FeeImpact, AgentStatusError>> {
  const { data, error } = await supabase.rpc("agent_status_fee_impact", { agent_id: agentId, kind: kindOf(action) })
  if (error) return { ok: false, error: statusError(error, "Could not read an agent status change's fee impact") }
  const rows = data as FeeImpactRow[]
  return {
    ok: true,
    data: {
      families: rows.map(feeImpactFamily),
    },
  }
}

// Switches an agent off or on, or retires them, with the Manager's reason.
// Needs agents.approve. Returns how many families' interview fees moved: the
// number recorded on the status change.
export async function changeAgentStatus(
  supabase: SupabaseClient,
  agentId: string,
  action: AgentStatusAction,
  reason: string,
): Promise<Result<{ feeChangeCount: number }, AgentStatusError>> {
  const { data, error } = await supabase.rpc("change_marketing_agent_status", {
    agent_id: agentId,
    kind: kindOf(action),
    reason: typeof reason === "string" ? reason : null,
  })
  if (error) {
    const refused = statusError(error, "Could not change a Marketing Agent's status")
    // Not a refusal the database gave: the change may have committed.
    return { ok: false, error: refused === "unavailable" ? "uncertain" : refused }
  }
  return { ok: true, data: { feeChangeCount: data as number } }
}

// ---------------------------------------------------------------------------
// Creating an agent, and Recreate (#189).
// ---------------------------------------------------------------------------

// What the Manager types. Empty optional fields are none; the code, left
// out, is generated from the name when the agent is saved.
export type AgentDraft = {
  fullName: string
  phone: string
  whatsapp?: string | null
  email?: string | null
  code?: string | null
}

export type AgentDraftField = "full_name" | "phone" | "whatsapp" | "email" | "code"

// An agent as the Manager's messages name them. Retired records never
// appear here.
export type AgentRef = { id: string; fullName: string; code: string; state: "Pending" | "Approved" | "Switched off" }

// What saving would meet, short of saving.
export type AgentConflict =
  | { kind: "phone-taken"; agent: AgentRef }
  | { kind: "code-taken"; agent: AgentRef }
  | { kind: "retired-code"; agent: { id: string; fullName: string; code: string }; studentCount: number }

export type AgentCheck =
  | {
      kind: "ready"
      fullName: string
      phone: string
      whatsapp: string | null
      email: string | null
      // Null when the code is generated on saving, from codePrefix.
      code: string | null
      codePrefix: string
    }
  | AgentConflict

export type CreatedAgent = { kind: "created"; agent: { id: string; fullName: string; code: string; phone: string } }

// "uncertain": a save met an error it can't read as a refusal, so it may
// have been saved. Only a save returns it.
export type CreateAgentError =
  | { kind: "forbidden" }
  | { kind: "invalid"; field: AgentDraftField }
  // A Promo code holds the code typed.
  | { kind: "promo-code-taken" }
  | EmailTaken
  | { kind: "unavailable" }
  | { kind: "uncertain" }

export type RecreateError =
  | { kind: "forbidden" }
  | { kind: "not-found" }
  // Retired, and Recreate can't start from it: its code is held again, or
  // another record that held the code retired after it.
  | { kind: "retired" }
  | { kind: "invalid"; field: AgentDraftField | "reason" }
  | { kind: "phone-taken"; agent: AgentRef }
  | EmailTaken
  | { kind: "unavailable" }
  | { kind: "uncertain" }

export type RecreatePreview = {
  agent: { id: string; fullName: string; phone: string; whatsapp: string | null; email: string | null; code: string; retired: boolean }
  // Every lead carrying the code: these follow it to the new record.
  studentCount: number
  // The families whose interview fee the Recreate moves.
  families: FeeImpactFamily[]
}

export type RecreatedAgent = { agent: { id: string; fullName: string; code: string }; studentCount: number; feeChangeCount: number }

const DRAFT_FIELDS = new Set<string>(["full_name", "phone", "whatsapp", "email", "code", "reason"])

type DbError = { message: string; code?: string; details?: string | null }
type AgentRefRow = { id: string; full_name: string; code: string; state: AgentRef["state"] }

function draftField(error: DbError): AgentDraftField | "reason" | null {
  if (error.message !== "invalid") return null
  try {
    const field = JSON.parse(error.details ?? "")?.field
    return typeof field === "string" && DRAFT_FIELDS.has(field) ? (field as AgentDraftField | "reason") : null
  } catch {
    return null
  }
}

function agentRef(row: AgentRefRow): AgentRef {
  return { id: row.id, fullName: row.full_name, code: row.code, state: row.state }
}

const text = (value: unknown) => (typeof value === "string" ? value : null)

function draftArgs(draft: Omit<AgentDraft, "code">) {
  return { full_name: text(draft.fullName), phone: text(draft.phone), whatsapp: text(draft.whatsapp), email: text(draft.email) }
}

// A refusal the database gave, or null when the error is something else.
function createRefusal(error: DbError, email: unknown): CreateAgentError | null {
  // 42501: the function isn't granted to the caller at all, as for someone signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  // A Promo code holds the code: there is no agent to name.
  if (error.message === "code_taken") return { kind: "promo-code-taken" }
  if (error.message === "email_taken") return emailTakenFrom(error.details, text(email))
  const field = draftField(error)
  if (field && field !== "reason") return { kind: "invalid", field }
  return null
}

type OutcomeRow =
  | { outcome: "ready"; full_name: string; phone: string; whatsapp: string | null; email: string | null; code: string | null; code_prefix: string }
  | { outcome: "created"; agent: { id: string; full_name: string; code: string; phone: string } }
  | { outcome: "phone_taken" | "code_taken"; agent: AgentRefRow }
  | { outcome: "retired_code"; agent: { id: string; full_name: string; code: string }; student_count: number }

function conflictOf(row: OutcomeRow): AgentConflict | null {
  if (row.outcome === "phone_taken") return { kind: "phone-taken", agent: agentRef(row.agent) }
  if (row.outcome === "code_taken") return { kind: "code-taken", agent: agentRef(row.agent) }
  if (row.outcome === "retired_code") {
    return {
      kind: "retired-code",
      agent: { id: row.agent.id, fullName: row.agent.full_name, code: row.agent.code },
      studentCount: row.student_count,
    }
  }
  return null
}

// What the Manager checks before saving: the details as they will be
// stored, or what saving would meet. Saves nothing. Needs agents.approve.
export async function checkNewAgent(supabase: SupabaseClient, draft: AgentDraft): Promise<Result<AgentCheck, CreateAgentError>> {
  const { data, error } = await supabase.rpc("check_marketing_agent", { ...draftArgs(draft), code: text(draft.code) })
  if (error) {
    const refused = createRefusal(error, draft.email)
    if (refused) return { ok: false, error: refused }
    console.error("Could not check a new Marketing Agent", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const row = data as OutcomeRow
  const conflict = conflictOf(row)
  if (conflict) return { ok: true, data: conflict }
  if (row.outcome !== "ready") {
    console.error("Unexpected answer checking a Marketing Agent", row)
    return { ok: false, error: { kind: "unavailable" } }
  }
  return {
    ok: true,
    data: {
      kind: "ready",
      fullName: row.full_name,
      phone: row.phone,
      whatsapp: row.whatsapp,
      email: row.email,
      code: row.code,
      codePrefix: row.code_prefix,
    },
  }
}

// The Manager's create. Needs agents.approve. The agent starts Approved,
// approved by the Manager; an email given here counts as confirmed. A phone
// or code already in use, or a retired code, creates nothing and says so.
export async function createAgent(
  supabase: SupabaseClient,
  draft: AgentDraft,
): Promise<Result<CreatedAgent | AgentConflict, CreateAgentError>> {
  const { data, error } = await supabase.rpc("create_marketing_agent", { ...draftArgs(draft), code: text(draft.code) })
  if (error) {
    const refused = createRefusal(error, draft.email)
    if (refused) return { ok: false, error: refused }
    console.error("Could not create a Marketing Agent", error)
    return { ok: false, error: { kind: "uncertain" } }
  }
  const row = data as OutcomeRow
  const conflict = conflictOf(row)
  if (conflict) return { ok: true, data: conflict }
  if (row.outcome !== "created") {
    console.error("Unexpected answer creating a Marketing Agent", row)
    return { ok: false, error: { kind: "uncertain" } }
  }
  return {
    ok: true,
    data: { kind: "created", agent: { id: row.agent.id, fullName: row.agent.full_name, code: row.agent.code, phone: row.agent.phone } },
  }
}

function recreateRefusal(error: DbError, email: unknown = null): RecreateError | null {
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  // A malformed id is no agent at all.
  if (error.message === "not_found" || error.code === "22P02") return { kind: "not-found" }
  if (error.message === "agent_retired") return { kind: "retired" }
  if (error.message === "email_taken") return emailTakenFrom(error.details, text(email))
  if (error.message === "phone_taken") {
    try {
      return { kind: "phone-taken", agent: agentRef(JSON.parse(error.details ?? "") as AgentRefRow) }
    } catch {
      return null
    }
  }
  const field = draftField(error)
  if (field) return { kind: "invalid", field }
  return null
}

type PreviewRow = {
  agent: { id: string; full_name: string; phone: string; whatsapp: string | null; email: string | null; code: string; retired: boolean }
  student_count: number
  families: FeeImpactRow[]
}

// What the Recreate dialog shows first: the record, how many students carry
// its code and the families whose fee moves. Needs agents.approve and
// leads.view, read in one snapshot.
export async function getRecreatePreview(supabase: SupabaseClient, agentId: string): Promise<Result<RecreatePreview, RecreateError>> {
  const { data, error } = await supabase.rpc("agent_recreate_preview", { agent_id: agentId })
  if (error) {
    const refused = recreateRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not read a Recreate's preview", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const row = data as PreviewRow
  return {
    ok: true,
    data: {
      agent: {
        id: row.agent.id,
        fullName: row.agent.full_name,
        phone: row.agent.phone,
        whatsapp: row.agent.whatsapp,
        email: row.agent.email,
        code: row.agent.code,
        retired: row.agent.retired,
      },
      studentCount: row.student_count,
      families: row.families.map(feeImpactFamily),
    },
  }
}

// Recreate: retires the record (or records the recreation of one already
// retired) and creates the corrected one with the same code, Approved and
// switched on, in one transaction. A linked login moves to the new record.
// Needs agents.approve and a reason.
export async function recreateAgent(
  supabase: SupabaseClient,
  agentId: string,
  draft: Omit<AgentDraft, "code">,
  reason: string,
): Promise<Result<RecreatedAgent, RecreateError>> {
  const { data, error } = await supabase.rpc("recreate_marketing_agent", {
    agent_id: agentId,
    ...draftArgs(draft),
    reason: text(reason),
  })
  if (error) {
    const refused = recreateRefusal(error, draft.email)
    if (refused) return { ok: false, error: refused }
    console.error("Could not recreate a Marketing Agent", error)
    return { ok: false, error: { kind: "uncertain" } }
  }
  const row = data as { agent: { id: string; full_name: string; code: string }; student_count: number; fee_change_count: number }
  return {
    ok: true,
    data: {
      agent: { id: row.agent.id, fullName: row.agent.full_name, code: row.agent.code },
      studentCount: row.student_count,
      feeChangeCount: row.fee_change_count,
    },
  }
}
