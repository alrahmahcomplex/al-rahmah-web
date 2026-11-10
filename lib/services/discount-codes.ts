import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { FeeImpactFamily } from "./marketing-agents"
import type { Result } from "./result"

// Discount amounts: the standard interview discount and each agent's own
// amount. Every amount is whole TZS off the standard interview fee of
// TZS 50,000, from 0 to 50,000. Writes need discount_codes.manage, which the
// database checks itself, and a reason; each returns how many families'
// unpaid interview fees moved. A Paid fee keeps its amount. Promo codes are
// in lib/services/promo-codes.ts.

export const STANDARD_INTERVIEW_FEE = 50_000
export const MAX_DISCOUNT = 50_000
export const REASON_MAX = 500

export type DiscountWriteError =
  | "forbidden"
  | "not-found"
  // The agent is retired.
  | "retired"
  // The amount is already that.
  | "no-change"
  | "invalid-amount"
  | "invalid-reason"
  | "unavailable"
  // An error that may hide a saved change.
  | "uncertain"

export type DiscountImpactError = "forbidden" | "not-found" | "retired" | "invalid-amount" | "unavailable"

export type FeeChange = { feeChangeCount: number }

type DbError = { message: string; code?: string; details?: string | null }

function invalidField(error: DbError): string | null {
  if (error.message !== "invalid") return null
  try {
    return (JSON.parse(error.details ?? "") as { field?: string }).field ?? null
  } catch {
    return null
  }
}

// Shared with promo-codes.ts.
export function discountRefusal(error: DbError): DiscountWriteError | null {
  // 42501: the function isn't granted to the caller at all, as for someone signed out.
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  if (error.message === "not_found" || error.code === "22P02") return "not-found"
  if (error.message === "retired") return "retired"
  if (error.message === "no_change") return "no-change"
  const field = invalidField(error)
  if (field === "amount") return "invalid-amount"
  if (field === "reason") return "invalid-reason"
  return null
}

function impactRefusal(error: DbError): DiscountImpactError | null {
  const refused = discountRefusal(error)
  return refused === "forbidden" || refused === "not-found" || refused === "retired" || refused === "invalid-amount" ? refused : null
}

export type FeeImpactRow = {
  lead_id: string
  admission_number: string
  student_name: string
  class_name: string
  contact_name: string
  contact_phone: string
  fee_now: number
  fee_after: number
}

export function feeImpactFamilies(rows: FeeImpactRow[]): FeeImpactFamily[] {
  return rows.map((row) => ({
    leadId: row.lead_id,
    admissionNumber: row.admission_number,
    studentName: row.student_name,
    className: row.class_name,
    contactName: row.contact_name,
    contactPhone: row.contact_phone,
    feeNow: row.fee_now,
    feeAfter: row.fee_after,
  }))
}

export const validAmount = (amount: unknown): amount is number =>
  typeof amount === "number" && Number.isInteger(amount) && amount >= 0 && amount <= MAX_DISCOUNT

// The standard interview discount in whole TZS. Signed-in staff and the
// secret key.
export async function getStandardDiscount(supabase: SupabaseClient): Promise<Result<number, "unavailable">> {
  const { data, error } = await supabase.rpc("standard_interview_discount")
  if (error || typeof data !== "number") {
    console.error("Could not read the standard interview discount", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data }
}

// The families whose unpaid interview fee the new standard amount would move.
export async function getStandardDiscountImpact(
  supabase: SupabaseClient,
  amount: number,
): Promise<Result<FeeImpactFamily[], DiscountImpactError>> {
  if (!validAmount(amount)) return { ok: false, error: "invalid-amount" }
  const { data, error } = await supabase.rpc("standard_discount_fee_impact", { amount })
  if (error) {
    const refused = impactRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not read the standard discount's fee impact", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: feeImpactFamilies(data as FeeImpactRow[]) }
}

export async function setStandardDiscount(
  supabase: SupabaseClient,
  amount: number,
  reason: string,
): Promise<Result<FeeChange, DiscountWriteError>> {
  if (!validAmount(amount)) return { ok: false, error: "invalid-amount" }
  const { data, error } = await supabase.rpc("set_standard_interview_discount", { amount, reason })
  if (error) {
    const refused = discountRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not set the standard interview discount", error)
    return { ok: false, error: "uncertain" }
  }
  return { ok: true, data: { feeChangeCount: (data as { fee_change_count: number }).fee_change_count } }
}

// The families whose unpaid interview fee an agent's new amount would move.
// Null is back to the standard.
export async function getAgentDiscountImpact(
  supabase: SupabaseClient,
  agentId: string,
  amount: number | null,
): Promise<Result<FeeImpactFamily[], DiscountImpactError>> {
  if (amount !== null && !validAmount(amount)) return { ok: false, error: "invalid-amount" }
  const { data, error } = await supabase.rpc("agent_discount_fee_impact", { agent_id: agentId, amount })
  if (error) {
    const refused = impactRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not read an agent discount's fee impact", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: feeImpactFamilies(data as FeeImpactRow[]) }
}

// Sets an agent's own amount, or with null puts them back on the standard.
// A retired record is refused.
export async function setAgentDiscount(
  supabase: SupabaseClient,
  agentId: string,
  amount: number | null,
  reason: string,
): Promise<Result<FeeChange, DiscountWriteError>> {
  if (amount !== null && !validAmount(amount)) return { ok: false, error: "invalid-amount" }
  const { data, error } = await supabase.rpc("set_agent_interview_discount", { agent_id: agentId, amount, reason })
  if (error) {
    const refused = discountRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not set an agent's interview discount", error)
    return { ok: false, error: "uncertain" }
  }
  return { ok: true, data: { feeChangeCount: (data as { fee_change_count: number }).fee_change_count } }
}

// The setting line above the Agents table: the standard amount and how many
// current agents are Approved, switched on and on the standard.
export type StandardDiscountSummary = { amount: number; approvedAgentsOnStandard: number }

export async function getStandardDiscountSummary(supabase: SupabaseClient): Promise<Result<StandardDiscountSummary, "unavailable">> {
  const [amount, agents] = await Promise.all([
    getStandardDiscount(supabase),
    supabase
      .from("marketing_agents")
      .select("id", { count: "exact", head: true })
      .is("retired_at", null)
      .is("switched_off_at", null)
      .is("interview_discount", null)
      .eq("status", "Approved"),
  ])
  if (!amount.ok) return amount
  if (agents.error) {
    console.error("Could not count the agents on the standard discount", agents.error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: { amount: amount.data, approvedAgentsOnStandard: agents.count ?? 0 } }
}

// The most an agent's code takes off now: the standard, or a larger own
// amount of a current, Approved, switched-on agent. The Promo code sheet
// compares its amount with this.
export async function getHighestAgentDiscount(supabase: SupabaseClient): Promise<Result<number, "unavailable">> {
  const [standard, own] = await Promise.all([
    getStandardDiscount(supabase),
    supabase
      .from("marketing_agents")
      .select("interview_discount")
      .is("retired_at", null)
      .is("switched_off_at", null)
      .eq("status", "Approved")
      .not("interview_discount", "is", null)
      .order("interview_discount", { ascending: false })
      .limit(1)
      .maybeSingle<{ interview_discount: number }>(),
  ])
  if (!standard.ok) return standard
  if (own.error) {
    console.error("Could not read the highest agent discount", own.error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: Math.max(standard.data, own.data?.interview_discount ?? 0) }
}

// One row of the history of amount and Promo code changes.
export type DiscountChangeKind = "standard" | "agent" | "promo_amount" | "promo_state" | "promo_created" | "promo_ends"

export type DiscountChange = {
  id: string
  kind: DiscountChangeKind
  agentId: string | null
  promoCodeId: string | null
  // As text: an amount, a state or a date. Null for an agent is the
  // standard; for a last day, no end.
  oldValue: string | null
  newValue: string | null
  reason: string | null
  changedAt: string
  studentCount: number
}

type ChangeRow = {
  id: string
  kind: DiscountChangeKind
  agent_id: string | null
  promo_code_id: string | null
  old_value: string | null
  new_value: string | null
  reason: string | null
  changed_at: string
  student_count: number
}

// The changes to one agent's amount or one Promo code, newest first. Staff
// without leads.view read none.
export async function listDiscountChanges(
  supabase: SupabaseClient,
  of: { agentId: string } | { promoCodeId: string } | { standard: true },
  limit = 20,
): Promise<Result<DiscountChange[], "unavailable">> {
  let list = supabase
    .from("discount_amount_changes")
    .select("id, kind, agent_id, promo_code_id, old_value, new_value, reason, changed_at, student_count")
  if ("agentId" in of) list = list.eq("agent_id", of.agentId)
  else if ("promoCodeId" in of) list = list.eq("promo_code_id", of.promoCodeId)
  else list = list.eq("kind", "standard")
  const { data, error } = await list
    .order("changed_at", { ascending: false })
    .order("sequence", { ascending: false })
    .limit(limit)
    .overrideTypes<ChangeRow[], { merge: false }>()
  if (error) {
    console.error("Could not list discount amount changes", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: data.map((row) => ({
      id: row.id,
      kind: row.kind,
      agentId: row.agent_id,
      promoCodeId: row.promo_code_id,
      oldValue: row.old_value,
      newValue: row.new_value,
      reason: row.reason,
      changedAt: row.changed_at,
      studentCount: row.student_count,
    })),
  }
}
