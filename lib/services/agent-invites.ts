import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// Agent invites, account states and email edits (#191). The database checks
// agents.approve and the agent's state on the Manager's session, and records
// every attempt in agent_events; only the email itself goes out with the
// secret key, through `send` (utils/supabase/admin.ts).

// The agent's account state (CONTEXT.md, Account state). A Pending agent has
// none: approval comes first.
export const ACCOUNT_STATES = [
  "retired",
  "switched_off",
  "awaiting_confirmation",
  "no_email",
  "invite_not_sent",
  "invite_expired",
  "invited",
  "joined",
] as const
export type AccountState = (typeof ACCOUNT_STATES)[number]

// The states the Agents screen counts towards "needs attention".
export const NEEDS_ATTENTION: readonly AccountState[] = ["awaiting_confirmation", "invite_not_sent", "invite_expired"]

export function isAccountState(value: unknown): value is AccountState {
  return typeof value === "string" && (ACCOUNT_STATES as readonly string[]).includes(value)
}

// Sends Supabase's invite email, marked as an agent's so the template uses
// the agent wording, with the link back to redirectTo.
export type AgentInviteSender = (
  email: string,
  redirectTo: string,
) => Promise<{ error: { message: string; status?: number; code?: string } | null }>

export type SendFailure =
  | { kind: "rate-limited" }
  | { kind: "smtp-error" }
  | { kind: "rejected-address" }
  | { kind: "other-error"; code: string }

export type AgentInviteError =
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "retired" }
  | { kind: "switched-off" }
  | { kind: "not-approved" }
  | { kind: "no-email" }
  | { kind: "already-joined" }
  | { kind: "access-off" }
  // The email is no longer the one the Manager saw, so nothing was sent.
  | { kind: "email-changed" }
  | { kind: "unavailable" }
  | SendFailure

export type SentInvite = { email: string; resend: boolean }

const PREPARE_REFUSALS: Record<string, AgentInviteError> = {
  not_permitted: { kind: "forbidden" },
  not_found: { kind: "not-found" },
  retired: { kind: "retired" },
  switched_off: { kind: "switched-off" },
  not_approved: { kind: "not-approved" },
  no_email: { kind: "no-email" },
  already_joined: { kind: "already-joined" },
  email_changed: { kind: "email-changed" },
}

const RECORDED: Record<SendFailure["kind"], string> = {
  "rate-limited": "rate_limited",
  "smtp-error": "smtp_error",
  "rejected-address": "rejected_address",
  "other-error": "other_error",
}

// What stopped the email, from Auth's answer.
export function classifySendFailure(error: { message: string; status?: number; code?: string }): SendFailure {
  if (error.status === 429 || error.code === "over_email_send_rate_limit" || error.code === "over_request_rate_limit") {
    return { kind: "rate-limited" }
  }
  if (error.code === "email_address_invalid" || error.code === "email_address_not_authorized") {
    return { kind: "rejected-address" }
  }
  if (/error sending .*email/i.test(error.message)) return { kind: "smtp-error" }
  return { kind: "other-error", code: error.code ?? (error.status ? `http_${error.status}` : "unknown") }
}

// Sends one invite (or a resend) to the agent's current email and records
// how it went. Approving or confirming never waits on this: callers report a
// failure as "Invite not sent" and offer Resend. With `expectedEmail`, the
// address the Manager saw, nothing goes out if the email has changed since.
// The database checks the agent and starts the attempt before the send, so
// the result is recorded even if the agent is switched off meanwhile.
export async function sendAgentInvite(
  supabase: SupabaseClient,
  send: AgentInviteSender,
  agentId: string,
  redirectTo: string,
  { expectedEmail }: { expectedEmail?: string } = {},
): Promise<Result<SentInvite, AgentInviteError>> {
  const prepared = await supabase.rpc("prepare_agent_invite", {
    agent_id: agentId,
    expected_email: expectedEmail ?? null,
  })
  if (prepared.error) {
    const refusal = PREPARE_REFUSALS[prepared.error.message]
    // 22P02: a malformed id is no agent. 42501: not granted, as for a visitor.
    if (refusal) return { ok: false, error: refusal }
    if (prepared.error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
    if (prepared.error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
    console.error("Could not prepare an agent invite", prepared.error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const row = ((prepared.data ?? []) as { outcome: string; email: string; resend: boolean; attempt_id: string | null }[])[0]
  if (!row) return { ok: false, error: { kind: "unavailable" } }
  if (row.outcome === "access_off") return { ok: false, error: { kind: "access-off" } }
  if (!row.attempt_id) return { ok: false, error: { kind: "unavailable" } }

  const { error } = await send(row.email, redirectTo)
  const failure = error ? classifySendFailure(error) : null
  if (failure && failure.kind === "other-error") console.error("An agent invite email could not be sent", error)

  // Recorded as soon as the send is done. The email has gone (or not) either
  // way, so a failure to record is logged, not reported as the send's result.
  const recorded = await supabase.rpc("record_agent_invite", {
    attempt_id: row.attempt_id,
    result: failure ? RECORDED[failure.kind] : "sent",
    error_code: failure?.kind === "other-error" ? failure.code : null,
  })
  if (recorded.error) console.error("Could not record an agent invite", agentId, recorded.error)

  if (failure) return { ok: false, error: failure }
  return { ok: true, data: { email: row.email, resend: row.resend } }
}

export type InviteAttempt = { agentId: string; result: Result<SentInvite, AgentInviteError> }

// Sends invites one at a time, stopping at the first rate limit: once Auth
// refuses, every later send would be refused too and only cost the hour.
export async function sendAgentInvites(
  supabase: SupabaseClient,
  send: AgentInviteSender,
  agentIds: readonly string[],
  redirectTo: string,
): Promise<InviteAttempt[]> {
  const attempts: InviteAttempt[] = []
  for (const agentId of agentIds) {
    const result = await sendAgentInvite(supabase, send, agentId, redirectTo)
    attempts.push({ agentId, result })
    if (!result.ok && result.error.kind === "rate-limited") break
  }
  return attempts
}

// ---------------------------------------------------------------------------
// Reads for the Agents screen.
// ---------------------------------------------------------------------------

export type AgentInviteNote = {
  email: string | null
  state: AccountState | null
  // When the latest invite to the current email went out.
  sentAt: string | null
  // The latest invite attempt, whatever its result.
  lastAttempt: { result: string; errorCode: string | null; at: string } | null
}

type InviteRow = {
  agent_id: string
  email: string | null
  state: string | null
  sent_at: string | null
  last_result: string | null
  last_error_code: string | null
  last_attempt_at: string | null
}

export async function getAgentInvites(
  supabase: SupabaseClient,
  agentIds: readonly string[],
): Promise<Result<Map<string, AgentInviteNote>, "forbidden" | "unavailable">> {
  const notes = new Map<string, AgentInviteNote>()
  if (agentIds.length === 0) return { ok: true, data: notes }
  const { data, error } = await supabase.rpc("agent_invites", { agent_ids: agentIds })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read the agents' invites", error)
    return { ok: false, error: "unavailable" }
  }
  for (const row of (data ?? []) as InviteRow[]) {
    notes.set(row.agent_id, {
      email: row.email,
      state: isAccountState(row.state) ? row.state : null,
      sentAt: row.sent_at,
      lastAttempt:
        row.last_result && row.last_attempt_at
          ? { result: row.last_result, errorCode: row.last_error_code, at: row.last_attempt_at }
          : null,
    })
  }
  return { ok: true, data: notes }
}

export type AccountCounts = Record<AccountState, number>

export async function getAgentAccountCounts(
  supabase: SupabaseClient,
): Promise<Result<AccountCounts, "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("agent_account_counts")
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not count the agents' account states", error)
    return { ok: false, error: "unavailable" }
  }
  const counts = Object.fromEntries(ACCOUNT_STATES.map((state) => [state, 0])) as AccountCounts
  for (const row of (data ?? []) as { state: string; agents: number }[]) {
    if (isAccountState(row.state)) counts[row.state] = Number(row.agents)
  }
  return { ok: true, data: counts }
}

// ---------------------------------------------------------------------------
// Adding or correcting an agent's email.
// ---------------------------------------------------------------------------

export type EmailHolder = "staff" | "agent" | "login"

export type SetEmailError =
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "retired" }
  // The agent has joined: their email is their sign-in, which only they change.
  | { kind: "already-joined" }
  | { kind: "email-invalid" }
  | { kind: "no-change" }
  | { kind: "email-taken"; holder: EmailHolder; name: string | null; code: string | null }
  | { kind: "unavailable" }

export type EmailChange = { email: string; previousEmail: string | null }

const EMAIL_REFUSALS: Record<string, SetEmailError> = {
  not_permitted: { kind: "forbidden" },
  not_found: { kind: "not-found" },
  retired: { kind: "retired" },
  already_joined: { kind: "already-joined" },
  email_invalid: { kind: "email-invalid" },
  no_change: { kind: "no-change" },
}

function takenBy(details: string | null | undefined): SetEmailError {
  try {
    const parsed = JSON.parse(details ?? "") as { holder?: EmailHolder; name?: string | null; code?: string | null }
    if (parsed.holder === "staff" || parsed.holder === "agent" || parsed.holder === "login") {
      return { kind: "email-taken", holder: parsed.holder, name: parsed.name ?? null, code: parsed.code ?? null }
    }
  } catch {
    // Falls through: guard_login's refusal names no holder.
  }
  return { kind: "email-taken", holder: "login", name: null, code: null }
}

function emailRefusal(error: { message: string; code?: string; details?: string | null }): SetEmailError | null {
  const refusal = EMAIL_REFUSALS[error.message]
  if (refusal) return refusal
  if (error.message === "email_taken") return takenBy(error.details)
  // 23505: another agent saved the same email a moment earlier.
  if (error.code === "23505") return { kind: "email-taken", holder: "agent", name: null, code: null }
  if (error.code === "22P02") return { kind: "not-found" }
  if (error.code === "42501") return { kind: "forbidden" }
  return null
}

// Adds or corrects the agent's email before they join; any unused invite
// stops working. Once they have joined the database refuses: their email is
// their sign-in, kept in Supabase Auth, and only they change it (owner
// decision 41).
export async function setAgentEmail(
  supabase: SupabaseClient,
  agentId: string,
  email: string,
): Promise<Result<EmailChange, SetEmailError>> {
  const { data, error } = await supabase.rpc("set_marketing_agent_email", { agent_id: agentId, email })
  if (error) {
    const refusal = emailRefusal(error)
    if (refusal) return { ok: false, error: refusal }
    console.error("Could not save an agent's email", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const row = ((data ?? []) as { previous_email: string | null }[])[0]
  if (!row) return { ok: false, error: { kind: "unavailable" } }
  return { ok: true, data: { email: email.trim().toLowerCase(), previousEmail: row.previous_email } }
}
