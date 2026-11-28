import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { AGENTS_ORIGIN } from "@/lib/site-hosts"

import type { Result } from "./result"
import { sendSms, type SmsSender } from "./sms"

// The approval SMS (owner request 2026-11-28): a new agent who signed up with
// their mobile hears by SMS, once, that the office approved them and they can
// sign in. An agent who signed up by email gets the invite email instead.
// The database picks the mobile (claim_approval_sms, 20270207100100).

export type ApprovalSms = { kind: "sent"; phone: string } | { kind: "none" }

// Why a mobile login's SMS didn't go.
export type ApprovalSmsError = "access-off" | "budget-reached" | "not-sent" | "unavailable"

/** The SMS words, Swahili like the other agent SMS; it fits one SMS. */
export function approvalSms(): string {
  return `Al-Rahmah Complex: hongera, umethibitishwa! Ingia kwa namba yako ya simu na nenosiri lako uone dashibodi yako: ${AGENTS_ORIGIN}/auth`
}

/**
 * After the Manager approves `agentId`: texts the mobile the agent signs in
 * with, when they signed up by mobile. "none" when there is nothing to send.
 * `supabase` holds the secret key.
 */
export async function sendApprovalSms(supabase: SupabaseClient, send: SmsSender, agentId: string): Promise<Result<ApprovalSms, ApprovalSmsError>> {
  const { data, error } = await supabase.rpc("claim_approval_sms", { agent_id: agentId })
  if (error) {
    console.error("Approval SMS: could not read the agent's login", error)
    return { ok: false, error: "unavailable" }
  }
  const row = (data ?? {}) as { outcome?: unknown; phone?: unknown; agent?: unknown }
  if (row.outcome === "access_off") return { ok: false, error: "access-off" }
  if (row.outcome !== "send" || typeof row.phone !== "string") return { ok: true, data: { kind: "none" } }

  const sent = await sendSms(supabase, send, { kind: "approved", to: row.phone, agentId, message: approvalSms() })
  if (sent.ok) return { ok: true, data: { kind: "sent", phone: row.phone } }
  console.error("Approval SMS: not sent", sent.error)
  if (sent.error.kind === "budget-reached") return { ok: false, error: "budget-reached" }
  if (sent.error.kind === "unavailable") return { ok: false, error: "unavailable" }
  return { ok: false, error: "not-sent" }
}
