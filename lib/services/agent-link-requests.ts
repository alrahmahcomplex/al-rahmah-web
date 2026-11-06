import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { classifySendFailure, type AgentInviteSender, type SendFailure } from "./agent-invites"
import type { Result } from "./result"

// "Umesahau nenosiri?" and "Tuma kiungo kipya" (#194): a public request for
// a new password link. The server action checks Turnstile and the firewall
// key, then this file makes two calls with the secret key:
//
// - decideAgentLink: request_agent_link refuses while agent access is off,
//   counts the request against the per-email limit and the project-wide
//   hourly budget (agent_link_requests), and says what to send, if anything.
// - sendAgentLink: sends that email and records how it went. The action runs
//   it after the reply has gone, so the reply takes as long whether or not
//   the email belongs to an agent.
//
// Every outcome that may or may not send gets the same neutral reply.

// Requests in the last hour: per email, and for the whole project. The
// hourly budget keeps public requests from using up Supabase's hourly email
// limit (50), which agent invite batches (30) and staff invites share.
export type LinkLimits = { perEmailLimit: number; hourlyBudget: number }

export const DEFAULT_LINK_LIMITS: LinkLimits = { perEmailLimit: 3, hourlyBudget: 15 }

function wholeNumber(value: string | undefined): number | null {
  if (value === undefined || !/^\s*\d+\s*$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

// AGENT_LINK_PER_EMAIL_LIMIT and PUBLIC_EMAIL_HOURLY_BUDGET, each falling
// back to its default when missing or not a whole number, so a typo never
// turns a limit off.
export function readLinkLimits(env: Record<string, string | undefined> = process.env): LinkLimits {
  return {
    perEmailLimit: wholeNumber(env.AGENT_LINK_PER_EMAIL_LIMIT) ?? DEFAULT_LINK_LIMITS.perEmailLimit,
    hourlyBudget: wholeNumber(env.PUBLIC_EMAIL_HOURLY_BUDGET) ?? DEFAULT_LINK_LIMITS.hourlyBudget,
  }
}

export type LinkToSend = { kind: "reset" | "invite"; email: string; attemptId: string }

export type LinkDecision =
  | { kind: "access-off" }
  // The per-email limit.
  | { kind: "limited" }
  // The hourly budget.
  | { kind: "busy" }
  // Nobody to send to: not an agent, or not one who may have a link now.
  | { kind: "none" }
  | LinkToSend

export async function decideAgentLink(
  supabase: SupabaseClient,
  email: string,
  limits: LinkLimits,
): Promise<Result<LinkDecision, "unavailable">> {
  const { data, error } = await supabase.rpc("request_agent_link", {
    email,
    per_email_limit: limits.perEmailLimit,
    hourly_budget: limits.hourlyBudget,
  })
  if (error) {
    console.error("Could not check a password link request", error)
    return { ok: false, error: "unavailable" }
  }
  const row = ((data ?? []) as { outcome: string; email: string | null; attempt_id: string | null }[])[0]
  switch (row?.outcome) {
    case "access_off":
      return { ok: true, data: { kind: "access-off" } }
    case "limited":
    case "busy":
    case "none":
      return { ok: true, data: { kind: row.outcome } }
    case "reset":
    case "invite":
      if (row.email && row.attempt_id) return { ok: true, data: { kind: row.outcome, email: row.email, attemptId: row.attempt_id } }
  }
  console.error("Unexpected answer to a password link request", data)
  return { ok: false, error: "unavailable" }
}

// Both send through Supabase Auth with the secret key: a reset for an agent
// who has joined, the #191 invite for one who hasn't.
export type LinkSenders = { reset: AgentInviteSender; invite: AgentInviteSender }

// Where each link lands: the reset page, or the invite's set-password page.
export type LinkRedirects = { reset: string; invite: string }

const RECORDED: Record<SendFailure["kind"], string> = {
  "rate-limited": "rate_limited",
  "smtp-error": "smtp_error",
  "rejected-address": "rejected_address",
  "other-error": "other_error",
}

export async function sendAgentLink(
  supabase: SupabaseClient,
  senders: LinkSenders,
  redirects: LinkRedirects,
  link: LinkToSend,
): Promise<Result<null, SendFailure>> {
  const { error } = await senders[link.kind](link.email, redirects[link.kind])
  const failure = error ? classifySendFailure(error) : null
  if (failure) console.error(`A requested ${link.kind} email could not be sent`, error)

  const recorded = await supabase.rpc("record_agent_link", {
    attempt_id: link.attemptId,
    result: failure ? RECORDED[failure.kind] : "sent",
    error_code: failure?.kind === "other-error" ? failure.code : null,
  })
  if (recorded.error) console.error("Could not record a requested link", link.attemptId, recorded.error)

  return failure ? { ok: false, error: failure } : { ok: true, data: null }
}
