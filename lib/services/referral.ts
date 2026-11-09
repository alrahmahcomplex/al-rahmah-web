import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

import type { AgentStatus } from "./marketing-agents"
import type { Result } from "./result"

// The referral module (slice 4, #80): a lead's Referral code, the Marketing
// Agent it names, and the interview fee it sets. A lead stores only the
// normalized code; the agent and their status are read through it each time,
// so approving an agent changes every lead carrying the code at once. Codes
// are normalized and the amounts set in the database only.

// A code an Approved agent holds, a Pending agent's, a switched-off agent's
// (no discount, whatever their approval), or one no current agent holds.
export type ReferralState = "approved" | "pending" | "switched_off" | "unrecognised"

export type LeadReferral = {
  // The code as stored, such as BJN-402, or null when the lead has none.
  code: string | null
  // Null when there is no code. A Promo code reads `approved` while it gives
  // its discount and `switched_off` otherwise; discountState says which.
  state: ReferralState | null
  // The agent's name, when a current agent holds the code.
  agentName: string | null
  // When the code's agent was switched off, while they are.
  switchedOffAt: string | null
  // The expected interview fee in whole TZS, and whether the code's discount
  // brought it down.
  amount: number
  discountApplied: boolean
  // What holds the code: an agent record, a Promo code, or nothing.
  kind: DiscountCodeKind
  // The agent's or the Promo code's name; a retired agent's too.
  holderName: string | null
  // The code's state in full, null when there is no code.
  discountState: DiscountCodeState | null
  // Whole TZS the code takes off the interview fee right now.
  amountOff: number
  agentId: string | null
  promoCodeId: string | null
}

export type DiscountCodeKind = "agent" | "promo" | "none"

// An agent's code: approved, pending, switched_off, or retired (only retired
// records held it). A Promo code: active, paused, ended, or expired (Active
// past its last day). unrecognised: nothing holds the code.
export type DiscountCodeState =
  | "approved"
  | "pending"
  | "switched_off"
  | "retired"
  | "active"
  | "paused"
  | "ended"
  | "expired"
  | "unrecognised"

// The agent or Promo code a typed code belongs to, with what it takes off now.
export type FoundDiscountCode = {
  kind: "agent" | "promo"
  code: string
  holderName: string
  state: Exclude<DiscountCodeState, "unrecognised">
  amountOff: number
  agentId: string | null
  promoCodeId: string | null
}

// The agent a typed code belongs to.
export type ReferralAgent = { code: string; fullName: string; state: Exclude<ReferralState, "unrecognised"> }

export type GetLeadReferralError = "not-found" | "unavailable"

export type SetReferralCodeError =
  | "forbidden"
  | "not-found"
  // The lead is Declined, Inactive or Archived.
  | "lead-closed"
  // No Marketing Agent or Promo code holds the code.
  | "unknown-code"
  // Only a retired agent record holds the code.
  | "retired-code"
  // The lead already holds this code, or already has none.
  | "no-change"
  | "unavailable"

type FoundAgent = { code: string; full_name: string; status: AgentStatus; switched_off_at: string | null }

function stateOf(agent: FoundAgent | null | undefined): ReferralState {
  if (!agent) return "unrecognised"
  if (agent.switched_off_at) return "switched_off"
  return agent.status === "Approved" ? "approved" : "pending"
}

type DiscountRow = {
  kind: DiscountCodeKind
  code: string | null
  agent_id: string | null
  promo_code_id: string | null
  holder_name: string | null
  state: DiscountCodeState | null
  amount_off: number
}

// The legacy state, for screens that know agents only.
function referralStateOf(row: DiscountRow): ReferralState {
  if (row.kind === "promo") return row.state === "active" ? "approved" : "switched_off"
  if (row.kind === "agent" && row.state !== "retired") {
    if (row.state === "switched_off") return "switched_off"
    return row.state === "approved" ? "approved" : "pending"
  }
  return "unrecognised"
}

// The lead's Referral code with its holder, agent or Promo code, and the
// expected interview fee. Needs leads.view: the database refuses anyone
// else, and for them the lead is not found.
export async function getLeadReferral(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadReferral, GetLeadReferralError>> {
  const [discount, fee] = await Promise.all([
    supabase.rpc("lead_interview_discount", { lead_id: leadId }).single<DiscountRow>(),
    supabase
      .rpc("expected_interview_amount", { lead_id: leadId })
      .single<{ amount: number; discount_applied: boolean }>(),
  ])
  const failed = discount.error ?? fee.error
  if (failed) {
    // A malformed id is no lead at all; so is one the caller may not see.
    if (["not_found", "not_permitted", "forbidden"].includes(failed.message) || failed.code === "22P02") {
      return { ok: false, error: "not-found" }
    }
    console.error("Could not read a lead's Referral code", failed)
    return { ok: false, error: "unavailable" }
  }

  const row = discount.data as DiscountRow
  const expected = fee.data as { amount: number; discount_applied: boolean }
  // When a current agent holds the code and is switched off, since when.
  let switchedOffAt: string | null = null
  if (row.kind === "agent" && row.state === "switched_off" && row.code) {
    const agent = await supabase.rpc("find_marketing_agent", { typed_code: row.code }).maybeSingle<FoundAgent>()
    if (agent.error) {
      console.error("Could not read a lead's Referral code", agent.error)
      return { ok: false, error: "unavailable" }
    }
    switchedOffAt = agent.data?.switched_off_at ?? null
  }

  return {
    ok: true,
    data: {
      code: row.code,
      state: row.code ? referralStateOf(row) : null,
      agentName: row.kind === "agent" && row.state !== "retired" ? row.holder_name : null,
      switchedOffAt,
      amount: expected.amount,
      discountApplied: expected.discount_applied,
      kind: row.kind,
      holderName: row.holder_name,
      discountState: row.code ? (row.state ?? "unrecognised") : null,
      amountOff: row.amount_off,
      agentId: row.agent_id,
      promoCodeId: row.promo_code_id,
    },
  }
}

function setError(error: PostgrestError): SetReferralCodeError {
  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  if (error.message === "not_found" || error.code === "22P02") return "not-found"
  if (error.message === "lead_closed") return "lead-closed"
  if (error.message === "unknown_code") return "unknown-code"
  if (error.message === "retired_code") return "retired-code"
  if (error.message === "no_change") return "no-change"
  console.error("Could not set a lead's Referral code", error)
  return "unavailable"
}

// Sets the lead's Referral code to a registered Marketing Agent's, Pending or
// Approved, or a Promo code's in any state, matched however it is typed; null
// clears it. A code set this way
// records the staff reminder as its notice version, and clearing it clears
// the version. Needs leads.edit, and the lead must be open. Returns the code
// as stored.
export async function setLeadReferralCode(
  supabase: SupabaseClient,
  leadId: string,
  code: string | null,
): Promise<Result<{ code: string | null }, SetReferralCodeError>> {
  const { data, error } = await supabase.rpc("set_lead_referral_code", { lead_id: leadId, code })
  if (error) return { ok: false, error: setError(error) }
  return { ok: true, data: { code: (data as string | null) ?? null } }
}

// The Marketing Agent a typed code belongs to, matched however it is typed,
// or null when no agent holds it. Staff without leads.view find no one.
export async function findReferralAgent(
  supabase: SupabaseClient,
  code: string,
): Promise<Result<ReferralAgent | null, "unavailable">> {
  const { data, error } = await supabase
    .rpc("find_marketing_agent", { typed_code: code })
    .maybeSingle<FoundAgent>()
  if (error) {
    console.error("Could not look up a Referral code", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: true, data: null }
  return { ok: true, data: { code: data.code, fullName: data.full_name, state: stateOf(data) as ReferralAgent["state"] } }
}

// The agent record or Promo code a typed code belongs to, matched however it
// is typed, or null when nothing ever held it. For the referral panel, its
// editor and the check-in form. Staff without leads.view find nothing.
export async function findDiscountCode(
  supabase: SupabaseClient,
  code: string,
): Promise<Result<FoundDiscountCode | null, "unavailable">> {
  const { data, error } = await supabase
    .rpc("find_discount_code", { typed_code: code })
    .maybeSingle<{
      kind: "agent" | "promo"
      code: string
      holder_name: string
      state: FoundDiscountCode["state"]
      amount_off: number
      agent_id: string | null
      promo_code_id: string | null
    }>()
  if (error) {
    console.error("Could not look up a Discount code", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: true, data: null }
  return {
    ok: true,
    data: {
      kind: data.kind,
      code: data.code,
      holderName: data.holder_name,
      state: data.state,
      amountOff: data.amount_off,
      agentId: data.agent_id,
      promoCodeId: data.promo_code_id,
    },
  }
}

// What a code typed on the Admission form means for the interview fee: an
// Approved agent's code or an Active Promo code (`approved`), a Pending
// agent's (`pending`), a switched-off agent's or a paused, ended or expired
// Promo code (`switched_off`, no discount), or nobody's (`unknown`), with the
// fee per child in whole TZS after the code's own amount. The form states
// this amount, not the standard discount. Secret key only: the public form's
// Server Action calls it after the rate limit.
export type DiscountCodeEstimate = { state: "approved" | "pending" | "switched_off" | "unknown"; amount: number }

export async function estimateDiscountCode(
  supabase: SupabaseClient,
  code: string,
): Promise<Result<DiscountCodeEstimate, "unavailable">> {
  const { data, error } = await supabase
    .rpc("discount_code_estimate", { code })
    .single<{ state: DiscountCodeEstimate["state"]; amount: number }>()
  if (error) {
    console.error("Could not estimate a Discount code", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { state: data.state, amount: data.amount } }
}

// How long a read of the interview discount waits before giving up.
const DISCOUNT_WAIT_MS = 2000

// The standard interview discount, in whole TZS: what an Approved agent's
// code takes off unless the agent has an own amount. The Discount code page
// and the Referral code panel state it. Signed-in staff and the secret key only. Every
// caller can do without the figure, so the read gives up after 2 seconds
// (or when the caller's own signal fires) rather than hold up a fee.
export async function getInterviewDiscount(
  supabase: SupabaseClient,
  { signal }: { signal?: AbortSignal } = {},
): Promise<Result<number, "unavailable">> {
  const timeout = signal ? null : new AbortController()
  const timer = timeout ? setTimeout(() => timeout.abort(), DISCOUNT_WAIT_MS) : undefined
  try {
    const { data, error } = await supabase.rpc("interview_discount").abortSignal(signal ?? timeout!.signal)
    if (error || typeof data !== "number") {
      console.error("Could not read the interview discount", error)
      return { ok: false, error: "unavailable" }
    }
    return { ok: true, data }
  } finally {
    clearTimeout(timer)
  }
}

export type ApplyFormDiscountCodeError =
  // The value isn't a code, or the notice version isn't the Admission form's.
  | "invalid"
  // The lead closed before the code reached it.
  | "lead-closed"
  | "not-found"
  | "unavailable"

// Puts the code the Admission form sent on a lead the form created, whether or
// not an agent holds it, with the version of the code-holder notice the form
// showed (null when it showed none). Writes only into an empty code, so
// calling it again, or after staff set a code, changes nothing, the version
// included. Secret key only. Returns the code the lead now carries.
//
// The database holds this one version (#196 dropped the two-argument one), so
// a missing function is a failure like any other, with no second call.
export async function applyFormDiscountCode(
  supabase: SupabaseClient,
  leadId: string,
  code: string,
  noticeVersion: string | null,
): Promise<Result<{ code: string }, ApplyFormDiscountCodeError>> {
  const { data, error } = await supabase.rpc("apply_form_discount_code", {
    lead_id: leadId,
    code,
    notice_version: noticeVersion,
  })
  if (error) {
    if (error.message === "invalid") return { ok: false, error: "invalid" }
    if (error.message === "lead_closed") return { ok: false, error: "lead-closed" }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not put the form's Discount code on a lead", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { code: data as string } }
}
