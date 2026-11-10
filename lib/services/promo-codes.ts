import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { discountRefusal, feeImpactFamilies, validAmount, type DiscountWriteError, type FeeChange, type FeeImpactRow } from "./discount-codes"
import type { FeeImpactFamily } from "./marketing-agents"
import type { Result } from "./result"

// Promo codes: school codes with a name and an amount off the interview fee,
// never tied to an agent and never carrying commission. A code is 4 to 12
// letters and digits, unique across agent codes and Promo codes, and never
// changes. Active gives the discount; Paused gives nothing until resumed;
// Ended is final; an Active code past its last day reads as Expired. Writes
// need discount_codes.manage, which the database checks itself. A Paid fee
// keeps its amount.

export type PromoState = "active" | "paused" | "ended"
export type PromoEffectiveState = PromoState | "expired"

export type PromoCode = {
  id: string
  code: string
  name: string
  note: string | null
  amount: number
  // yyyy-mm-dd, the last day it gives its discount; null: no end.
  endsOn: string | null
  state: PromoState
  effectiveState: PromoEffectiveState
  // Leads carrying the code, and those whose interview fee is not yet Paid.
  studentCount: number
  unpaidCount: number
  createdAt: string
  updatedAt: string
}

export const PROMO_CODE_PATTERN = /^[A-Z0-9]{4,12}$/
export const PROMO_NAME_MAX = 80
export const PROMO_NOTE_MAX = 200

// The code as the database stores it, or null when it can't be one.
export function normalizePromoCode(raw: string): string | null {
  const code = raw.replace(/\s/g, "").toUpperCase()
  return PROMO_CODE_PATTERN.test(code) ? code : null
}

export type PromoWriteError =
  | DiscountWriteError
  // An agent record or another Promo code holds the code.
  | "code-taken"
  // The Promo code has ended; nothing about it changes again.
  | "ended"
  | "invalid-code"
  | "invalid-name"
  | "invalid-note"
  | "invalid-ends-on"
  | "invalid-state"

type DbError = { message: string; code?: string; details?: string | null }

function promoRefusal(error: DbError): PromoWriteError | null {
  if (error.message === "code_taken") return "code-taken"
  if (error.message === "ended") return "ended"
  if (error.message === "invalid") {
    try {
      const field = (JSON.parse(error.details ?? "") as { field?: string }).field
      if (field === "code") return "invalid-code"
      if (field === "name") return "invalid-name"
      if (field === "note") return "invalid-note"
      if (field === "ends_on") return "invalid-ends-on"
      if (field === "state") return "invalid-state"
    } catch {
      // Read below as the shared refusals.
    }
  }
  return discountRefusal(error)
}

type PromoRow = {
  id: string
  code: string
  name: string
  note: string | null
  amount: number
  ends_on: string | null
  state: PromoState
  effective_state: PromoEffectiveState
  student_count: number
  unpaid_count: number
  created_at: string
  updated_at: string
}

function promoOf(row: PromoRow): PromoCode {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    note: row.note,
    amount: row.amount,
    endsOn: row.ends_on,
    state: row.state,
    effectiveState: row.effective_state,
    studentCount: row.student_count,
    unpaidCount: row.unpaid_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// Every Promo code, Active first, then the newest. Needs leads.view.
export async function listPromoCodes(supabase: SupabaseClient): Promise<Result<PromoCode[], "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("list_promo_codes")
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not list the Promo codes", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: ((data ?? []) as PromoRow[]).map(promoOf) }
}

// One Promo code, or null when there is none.
export async function getPromoCode(supabase: SupabaseClient, id: string): Promise<Result<PromoCode | null, "forbidden" | "unavailable">> {
  const list = await listPromoCodes(supabase)
  if (!list.ok) return list
  return { ok: true, data: list.data.find((promo) => promo.id === id) ?? null }
}

// Whether a code typed while creating a Promo code is free: unreadable,
// free, a Promo code's, or an agent record's (current or retired). For the
// live check under the Code field. Needs leads.view.
export type CodeAvailability =
  | { kind: "invalid" }
  | { kind: "available"; code: string }
  | { kind: "promo-code"; code: string; name: string }
  | { kind: "agent"; code: string }

export async function checkPromoCodeAvailable(supabase: SupabaseClient, typed: string): Promise<Result<CodeAvailability, "unavailable">> {
  const code = normalizePromoCode(typed)
  if (!code) return { ok: true, data: { kind: "invalid" } }
  const { data, error } = await supabase
    .rpc("find_discount_code", { typed_code: code })
    .maybeSingle<{ kind: "agent" | "promo"; code: string; holder_name: string | null }>()
  if (error) {
    console.error("Could not check a Promo code", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: true, data: { kind: "available", code } }
  if (data.kind === "promo") return { ok: true, data: { kind: "promo-code", code, name: data.holder_name ?? "" } }
  return { ok: true, data: { kind: "agent", code } }
}

export type NewPromoCode = { name: string; code: string; amount: number; endsOn: string | null; note: string | null }

export async function createPromoCode(supabase: SupabaseClient, promo: NewPromoCode): Promise<Result<{ id: string; code: string }, PromoWriteError>> {
  if (!validAmount(promo.amount)) return { ok: false, error: "invalid-amount" }
  const { data, error } = await supabase
    .rpc("create_promo_code", { name: promo.name, code: promo.code, amount: promo.amount, ends_on: promo.endsOn, note: promo.note })
    .single<{ id: string; code: string }>()
  if (error) {
    const refused = promoRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not create a Promo code", error)
    return { ok: false, error: "uncertain" }
  }
  return { ok: true, data: { id: data.id, code: data.code } }
}

export type PromoCodeEdit = { name: string; amount: number; endsOn: string | null; note: string | null; reason: string | null }

// Edits the name, amount, last day and note. A reason is needed only when
// the amount or the last day changes.
export async function updatePromoCode(supabase: SupabaseClient, id: string, edit: PromoCodeEdit): Promise<Result<FeeChange, PromoWriteError>> {
  if (!validAmount(edit.amount)) return { ok: false, error: "invalid-amount" }
  const { data, error } = await supabase.rpc("update_promo_code", {
    id,
    name: edit.name,
    amount: edit.amount,
    ends_on: edit.endsOn,
    note: edit.note,
    reason: edit.reason,
  })
  if (error) {
    const refused = promoRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not update a Promo code", error)
    return { ok: false, error: "uncertain" }
  }
  return { ok: true, data: { feeChangeCount: (data as { fee_change_count: number }).fee_change_count } }
}

// Pauses, resumes (active) or ends a Promo code, with a reason.
export async function setPromoCodeState(
  supabase: SupabaseClient,
  id: string,
  state: PromoState,
  reason: string,
): Promise<Result<FeeChange, PromoWriteError>> {
  const { data, error } = await supabase.rpc("set_promo_code_state", { id, state, reason })
  if (error) {
    const refused = promoRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not change a Promo code's state", error)
    return { ok: false, error: "uncertain" }
  }
  return { ok: true, data: { feeChangeCount: (data as { fee_change_count: number }).fee_change_count } }
}

// The families whose unpaid interview fee would move with this amount,
// state or last day (each left out keeps the code's own; a null last day
// means none).
export async function getPromoCodeImpact(
  supabase: SupabaseClient,
  id: string,
  change: { amount?: number; state?: PromoState; endsOn?: string | null },
): Promise<Result<FeeImpactFamily[], PromoWriteError>> {
  if (change.amount !== undefined && !validAmount(change.amount)) return { ok: false, error: "invalid-amount" }
  const { data, error } = await supabase.rpc("promo_code_fee_impact", {
    id,
    amount: change.amount ?? null,
    state: change.state ?? null,
    ends_on: change.endsOn ?? null,
    ends_on_given: change.endsOn !== undefined,
  })
  if (error) {
    const refused = promoRefusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not read a Promo code's fee impact", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: feeImpactFamilies(data as FeeImpactRow[]) }
}
