import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { emailTakenFrom, type EmailTaken } from "@/lib/email-in-use"

import type { Result } from "./result"

// The Manager's "Awaiting email confirmation" queue (#193). A claim is an
// email typed on the Discount code page for an existing record, by someone
// who gave its code and mobile; nothing reaches the record until the Manager
// phones the agent and confirms. The database checks the permission and
// records every decision in agent_email_claims (append-only, audited).
//
// Confirming saves the email through set_marketing_agent_email, so it is
// refused once the agent has joined or when someone else holds the address,
// and auto-rejects the agent's other waiting claims. The caller then sends
// the invite with sendAgentInvite (agent-invites.ts), passing the saved
// email as expectedEmail.

export type QueueClaim = { id: string; fullName: string; email: string; claimedAt: string }

export type QueueEntry = {
  agentId: string
  // The stored record, beside each claim's typed name.
  fullName: string
  phone: string
  code: string
  status: "Pending" | "Approved"
  // When the oldest waiting claim came in; the queue is oldest first.
  claimedAt: string
  // Every waiting claim, oldest first. More than one: competing attempts.
  claims: QueueClaim[]
}

type QueueRow = {
  agent_id: string
  full_name: string
  phone: string
  code: string
  status: "Pending" | "Approved"
  claimed_at: string
  claims: { id: string; full_name: string; email: string; created_at: string }[]
}

export async function getEmailClaimQueue(supabase: SupabaseClient): Promise<Result<QueueEntry[], "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("agent_email_claim_queue")
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read the email claim queue", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: ((data ?? []) as QueueRow[]).map((row) => ({
      agentId: row.agent_id,
      fullName: row.full_name,
      phone: row.phone,
      code: row.code,
      status: row.status,
      claimedAt: row.claimed_at,
      claims: row.claims.map((claim) => ({
        id: claim.id,
        fullName: claim.full_name,
        email: claim.email,
        claimedAt: claim.created_at,
      })),
    })),
  }
}

export type ClaimDecisionError =
  | { kind: "forbidden" }
  | { kind: "not-found" }
  | { kind: "already-decided" }
  | { kind: "retired" }
  | { kind: "switched-off" }
  // The record got an email some other way, which is never overwritten.
  | { kind: "has-email" }
  | { kind: "already-joined" }
  | { kind: "email-invalid" }
  | EmailTaken
  | { kind: "unavailable" }

const REFUSALS: Record<string, ClaimDecisionError> = {
  not_permitted: { kind: "forbidden" },
  not_found: { kind: "not-found" },
  already_decided: { kind: "already-decided" },
  retired: { kind: "retired" },
  switched_off: { kind: "switched-off" },
  has_email: { kind: "has-email" },
  already_joined: { kind: "already-joined" },
  email_invalid: { kind: "email-invalid" },
}

async function decide(
  supabase: SupabaseClient,
  claimId: string,
  decision: "confirm" | "reject",
  email: string | null,
): Promise<Result<{ agentId: string; email: string | null }, ClaimDecisionError>> {
  const { data, error } = await supabase.rpc("decide_agent_email_claim", { claim_id: claimId, decision, email })
  if (error) {
    const refusal = REFUSALS[error.message]
    if (refusal) return { ok: false, error: refusal }
    if (error.message === "email_taken") return { ok: false, error: emailTakenFrom(error.details, email) }
    // 22P02: a malformed id is no claim. 42501: not granted, as for a visitor.
    if (error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
    if (error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
    console.error("Could not decide an email claim", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  const row = ((data ?? []) as { decided_agent_id: string; saved_email: string | null }[])[0]
  if (!row) return { ok: false, error: { kind: "unavailable" } }
  return { ok: true, data: { agentId: row.decided_agent_id, email: row.saved_email } }
}

// Confirm, or Save and send invite with the email the Manager corrected.
// Answers the agent and the email now on the record.
export async function confirmEmailClaim(
  supabase: SupabaseClient,
  claimId: string,
  email: string | null = null,
): Promise<Result<{ agentId: string; email: string }, ClaimDecisionError>> {
  const result = await decide(supabase, claimId, "confirm", email)
  if (!result.ok) return result
  if (!result.data.email) return { ok: false, error: { kind: "unavailable" } }
  return { ok: true, data: { agentId: result.data.agentId, email: result.data.email } }
}

export async function rejectEmailClaim(
  supabase: SupabaseClient,
  claimId: string,
): Promise<Result<{ agentId: string }, ClaimDecisionError>> {
  const result = await decide(supabase, claimId, "reject", null)
  if (!result.ok) return result
  return { ok: true, data: { agentId: result.data.agentId } }
}

// A code typed at sign-up that the record didn't get, and why.
export type SignUpNote = {
  typedCode: string
  // The current agent holding it, if any.
  holder: { id: string; fullName: string; code: string } | null
  // Only a retired record held it.
  retiredHolder: boolean
  // How many leads carry it.
  leadCount: number
}

type NoteRow = {
  agent_id: string
  typed_code: string
  holder: { id: string; full_name: string; code: string } | null
  retired_holder: boolean
  lead_count: number
}

export async function getSignUpNotes(
  supabase: SupabaseClient,
  agentIds: readonly string[],
): Promise<Result<Map<string, SignUpNote>, "forbidden" | "unavailable">> {
  const notes = new Map<string, SignUpNote>()
  if (agentIds.length === 0) return { ok: true, data: notes }
  const { data, error } = await supabase.rpc("agent_sign_up_notes", { agent_ids: agentIds })
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read the agents' sign-up notes", error)
    return { ok: false, error: "unavailable" }
  }
  for (const row of (data ?? []) as NoteRow[]) {
    notes.set(row.agent_id, {
      typedCode: row.typed_code,
      holder: row.holder ? { id: row.holder.id, fullName: row.holder.full_name, code: row.holder.code } : null,
      retiredHolder: row.retired_holder,
      leadCount: Number(row.lead_count),
    })
  }
  return { ok: true, data: notes }
}
