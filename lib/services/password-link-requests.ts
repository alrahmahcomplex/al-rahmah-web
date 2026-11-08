import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { classifySendFailure, type AgentInviteSender, type SendFailure } from "./agent-invites"
import type { Result } from "./result"

// A public request for a new password link, from "Umesahau nenosiri?" and
// "Tuma kiungo kipya" (#194), for staff and agents alike (#265). The server
// action checks Turnstile and the firewall key, then this file makes two
// calls with the secret key:
//
// - decidePasswordLink: request_password_link counts the request against the
//   per-email limit and the project-wide hourly budget (agent_link_requests),
//   then says what to send, if anything, and whether the login is staff's or
//   an agent's.
// - sendPasswordLink: sends that email and, for an agent, records how it
//   went. The action runs it after the reply has gone, so the reply takes as
//   long whether or not the email belongs to anyone.
//
// Every outcome that may or may not send gets the same neutral reply.

// Requests in the last hour: per email, and for the whole project. The
// hourly budget keeps public requests from using up Supabase's hourly email
// limit (50), which agent invite batches (30) and staff invites share.
// A Manager's "Send reset link" counts against the same budget.
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

export type Principal = "staff" | "agent"

// An agent's send closes the attempt the database opened; a staff member's
// has none.
export type LinkToSend = { kind: "reset" | "invite"; principal: Principal; email: string; attemptId: string | null }

export type LinkDecision =
  // The per-email limit.
  | { kind: "limited" }
  // The hourly budget.
  | { kind: "busy" }
  // Nobody to send to: not staff or an agent, or not one who may have a link
  // now (agent access being off included).
  | { kind: "none" }
  | LinkToSend

type Row = { outcome: string; principal: string | null; send_to: string | null; attempt_id: string | null }

export async function decidePasswordLink(
  supabase: SupabaseClient,
  email: string,
  limits: LinkLimits,
): Promise<Result<LinkDecision, "unavailable">> {
  const { data, error } = await supabase.rpc("request_password_link", {
    email,
    per_email_limit: limits.perEmailLimit,
    hourly_budget: limits.hourlyBudget,
  })
  if (error) {
    console.error("Could not check a password link request", error)
    return { ok: false, error: "unavailable" }
  }
  const row = ((data ?? []) as Row[])[0]
  switch (row?.outcome) {
    case "limited":
    case "busy":
    case "none":
      return { ok: true, data: { kind: row.outcome } }
    case "reset":
    case "invite":
      if (row.send_to && row.principal === "staff") {
        return { ok: true, data: { kind: row.outcome, principal: "staff", email: row.send_to, attemptId: null } }
      }
      if (row.send_to && row.principal === "agent" && row.attempt_id) {
        return { ok: true, data: { kind: row.outcome, principal: "agent", email: row.send_to, attemptId: row.attempt_id } }
      }
  }
  console.error("Unexpected answer to a password link request", data)
  return { ok: false, error: "unavailable" }
}

// Each sends through Supabase Auth with the secret key. Both resets are
// Supabase's one recovery email; the invites differ: staff get the staff
// invite, agents the #191 invite marked `kind: agent`.
export type LinkSenders = Record<Principal, { reset: AgentInviteSender; invite: AgentInviteSender }>

// Where each link lands. Both resets land on the shared reset page in the
// /login card; each invite on its own set-password page.
export type LinkRedirects = Record<Principal, { reset: string; invite: string }>

const RECORDED: Record<SendFailure["kind"], string> = {
  "rate-limited": "rate_limited",
  "smtp-error": "smtp_error",
  "rejected-address": "rejected_address",
  "other-error": "other_error",
}

export async function sendPasswordLink(
  supabase: SupabaseClient,
  senders: LinkSenders,
  redirects: LinkRedirects,
  link: LinkToSend,
): Promise<Result<null, SendFailure>> {
  const { error } = await senders[link.principal][link.kind](link.email, redirects[link.principal][link.kind])
  const failure = error ? classifySendFailure(error) : null
  if (failure) console.error(`A requested ${link.principal} ${link.kind} email could not be sent`, error)

  if (link.attemptId) {
    const recorded = await supabase.rpc("record_agent_link", {
      attempt_id: link.attemptId,
      result: failure ? RECORDED[failure.kind] : "sent",
      error_code: failure?.kind === "other-error" ? failure.code : null,
    })
    if (recorded.error) console.error("Could not record a requested link", link.attemptId, recorded.error)
  }

  return failure ? { ok: false, error: failure } : { ok: true, data: null }
}
