import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

import type { AgentStatus } from "./marketing-agents"
import type { Result } from "./result"

// The referral module (slice 4, #80): a lead's Referral code, the Marketing
// Agent it names, and the interview fee it sets. A lead stores only the
// normalized code; the agent and their status are read through it each time,
// so approving an agent changes every lead carrying the code at once. Codes
// are normalized and the amounts set in the database only.

// A code an Approved agent holds, a Pending agent's, or one no agent holds.
export type ReferralState = "approved" | "pending" | "unrecognised"

export type LeadReferral = {
  // The code as stored, such as BJN-402, or null when the lead has none.
  code: string | null
  // Null when there is no code.
  state: ReferralState | null
  // The agent's name, when an agent holds the code.
  agentName: string | null
  // The expected interview fee in whole TZS, and whether an Approved agent's
  // discount brought it down.
  amount: number
  discountApplied: boolean
}

// The agent a typed code belongs to.
export type ReferralAgent = { code: string; fullName: string; state: Exclude<ReferralState, "unrecognised"> }

export type GetLeadReferralError = "not-found" | "unavailable"

export type SetReferralCodeError =
  | "forbidden"
  | "not-found"
  // The lead is Declined, Inactive or Archived.
  | "lead-closed"
  // No Marketing Agent holds the code.
  | "unknown-code"
  // The lead already holds this code, or already has none.
  | "no-change"
  | "unavailable"

function stateOf(status: AgentStatus | null | undefined): ReferralState {
  if (status === "Approved") return "approved"
  if (status === "Pending") return "pending"
  return "unrecognised"
}

// The lead's Referral code with its agent and the expected interview fee.
// Needs leads.view: row-level security hides the lead from anyone else, so
// for them it is not found.
export async function getLeadReferral(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadReferral, GetLeadReferralError>> {
  const lead = await supabase
    .from("leads")
    .select("referral_code")
    .eq("id", leadId)
    .maybeSingle<{ referral_code: string | null }>()
  // A malformed id is no lead at all.
  if (lead.error?.code === "22P02") return { ok: false, error: "not-found" }
  if (lead.error) {
    console.error("Could not read a lead's Referral code", lead.error)
    return { ok: false, error: "unavailable" }
  }
  if (!lead.data) return { ok: false, error: "not-found" }

  const code = lead.data.referral_code
  const [agent, fee] = await Promise.all([
    code
      ? supabase
          .from("marketing_agents")
          .select("full_name, status")
          .eq("code", code)
          .maybeSingle<{ full_name: string; status: AgentStatus }>()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .rpc("expected_interview_amount", { lead_id: leadId })
      .single<{ amount: number; discount_applied: boolean }>(),
  ])
  if (agent.error || fee.error) {
    if (fee.error?.message === "not_found") return { ok: false, error: "not-found" }
    console.error("Could not read a lead's Referral code", agent.error ?? fee.error)
    return { ok: false, error: "unavailable" }
  }

  return {
    ok: true,
    data: {
      code,
      state: code ? stateOf(agent.data?.status) : null,
      agentName: agent.data?.full_name ?? null,
      amount: fee.data.amount,
      discountApplied: fee.data.discount_applied,
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
  if (error.message === "no_change") return "no-change"
  console.error("Could not set a lead's Referral code", error)
  return "unavailable"
}

// Sets the lead's Referral code to a registered Marketing Agent's, Pending or
// Approved, matched however it is typed; null clears it. Needs leads.edit,
// and the lead must be open. Returns the code as stored.
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
    .maybeSingle<{ code: string; full_name: string; status: AgentStatus }>()
  if (error) {
    console.error("Could not look up a Referral code", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: true, data: null }
  return { ok: true, data: { code: data.code, fullName: data.full_name, state: data.status === "Approved" ? "approved" : "pending" } }
}

// What a code typed on the Admission form means for the interview fee: an
// Approved agent's code (`approved`), a Pending agent's (`pending`), or no
// agent's (`unknown`), with the fee per child in whole TZS. Secret key only:
// the public form's Server Action calls it after the rate limit.
export type DiscountCodeEstimate = { state: "approved" | "pending" | "unknown"; amount: number }

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

export type ApplyFormDiscountCodeError =
  // The value isn't a code.
  | "invalid"
  // The lead closed before the code reached it.
  | "lead-closed"
  | "not-found"
  | "unavailable"

// Puts the code the Admission form sent on a lead the form created, whether or
// not an agent holds it. Writes only into an empty code, so calling it again,
// or after staff set a code, changes nothing. Secret key only. Returns the
// code the lead now carries.
export async function applyFormDiscountCode(
  supabase: SupabaseClient,
  leadId: string,
  code: string,
): Promise<Result<{ code: string }, ApplyFormDiscountCodeError>> {
  const { data, error } = await supabase.rpc("apply_form_discount_code", { lead_id: leadId, code })
  if (error) {
    if (error.message === "invalid") return { ok: false, error: "invalid" }
    if (error.message === "lead_closed") return { ok: false, error: "lead-closed" }
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not put the form's Discount code on a lead", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { code: data as string } }
}

// The same, for every lead an earlier send of the form created, when the
// parent edited the form and sent it again with the same submission key: the
// edited send creates nothing, so this finishes a code step the earlier send
// never reached. Children already on file get nothing. Secret key only.
// Returns how many leads got the code.
export async function applyFormDiscountCodeToSent(
  supabase: SupabaseClient,
  submissionKey: string,
  code: string,
): Promise<Result<{ applied: number }, "invalid" | "unavailable">> {
  const { data, error } = await supabase.rpc("apply_form_discount_code_to_sent", { submission_key: submissionKey, code })
  if (error) {
    if (error.message === "invalid") return { ok: false, error: "invalid" }
    console.error("Could not put the form's Discount code on an earlier send's leads", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { applied: data as number } }
}
