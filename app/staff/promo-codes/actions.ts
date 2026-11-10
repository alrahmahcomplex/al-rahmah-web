"use server"

import { revalidatePath } from "next/cache"

import { validAmount } from "@/lib/services/discount-codes"
import {
  checkPromoCodeAvailable,
  createPromoCode,
  getPromoCodeImpact,
  setPromoCodeState,
  updatePromoCode,
  type PromoState,
} from "@/lib/services/promo-codes"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import type { ImpactAnswer } from "../agents/discount-actions"
import { impactRefusal } from "../agents/discount-outcome"
import {
  createdMessage,
  promoRefusal,
  PROMO_NAME_MAX,
  PROMO_NOTE_MAX,
  savedMessage,
  stateMessage,
  typedPromoCode,
  type CodeCheck,
  type PromoOutcome,
} from "./messages"

// The Promo codes page's Server Actions. They take input from anyone who
// can post to them, so the shapes are checked here; the database then checks
// discount_codes.manage, the code, the amount and the reason itself.

async function manager() {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "discount_codes.manage")
  if (allowed.ok) return { ok: true as const, supabase }
  const error: "signed-out" | "unavailable" | "forbidden" =
    allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : "forbidden"
  return { ok: false as const, error }
}

const DAY = /^\d{4}-\d{2}-\d{2}$/
const STATES: readonly PromoState[] = ["active", "paused", "ended"]

// Empty text is none.
function optional(value: unknown): string | null | undefined {
  if (value === null || value === undefined) return null
  if (typeof value !== "string") return undefined
  return value.trim() === "" ? null : value.trim()
}

// Whether a code typed while creating a Promo code is free.
export async function checkPromoCode(typed: string): Promise<CodeCheck> {
  if (typeof typed !== "string" || typed.trim() === "") return { status: "empty" }
  if (typed.length > 40) return { status: "unreadable" }
  const client = await manager()
  if (!client.ok) return { status: "unavailable" }
  const found = await checkPromoCodeAvailable(client.supabase, typed)
  if (!found.ok) return { status: "unavailable" }
  const answer = found.data
  if (answer.kind === "invalid") return { status: "unreadable" }
  if (answer.kind === "available") return { status: "available", code: answer.code }
  return { status: "taken", code: answer.code, by: answer.kind }
}

// The families whose unpaid interview fee this amount or state would move.
export async function readPromoImpact(
  id: string,
  change: { amount?: number; state?: PromoState; endsOn?: string | null },
): Promise<ImpactAnswer> {
  if (typeof id !== "string") return { status: "refused", message: "This Promo code could not be found. Reload the page and try again." }
  const amount = change?.amount
  const state = change?.state
  const endsOn = change?.endsOn
  if (amount !== undefined && !validAmount(amount)) return { status: "refused", message: impactRefusal("invalid-amount") }
  if (state !== undefined && !STATES.includes(state)) return { status: "refused", message: promoRefusal("invalid-state").message }
  const client = await manager()
  if (!client.ok) return { status: "refused", message: impactRefusal(client.error) }
  if (endsOn !== undefined && endsOn !== null && !DAY.test(endsOn)) {
    return { status: "refused", message: promoRefusal("invalid-ends-on").message }
  }
  const result = await getPromoCodeImpact(client.supabase, id, { amount, state, endsOn })
  return result.ok ? { status: "ready", families: result.data } : { status: "refused", message: promoRefusal(result.error).message }
}

export type PromoDraft = { name: string; amount: number; endsOn: string | null; note: string | null }

// The draft as the database takes it, or the field that can't be.
function readDraft(draft: PromoDraft): { ok: true; data: PromoDraft } | { ok: false; outcome: PromoOutcome } {
  const name = typeof draft?.name === "string" ? draft.name.trim() : ""
  if (name === "" || name.length > PROMO_NAME_MAX) return { ok: false, outcome: promoRefusal("invalid-name") }
  if (!validAmount(draft.amount)) return { ok: false, outcome: promoRefusal("invalid-amount") }
  const endsOn = optional(draft.endsOn)
  if (endsOn === undefined || (endsOn !== null && !DAY.test(endsOn))) return { ok: false, outcome: promoRefusal("invalid-ends-on") }
  const note = optional(draft.note)
  if (note === undefined || (note !== null && note.length > PROMO_NOTE_MAX)) return { ok: false, outcome: promoRefusal("invalid-note") }
  return { ok: true, data: { name, amount: draft.amount, endsOn, note } }
}

export async function createPromo(draft: PromoDraft & { code: string }): Promise<PromoOutcome> {
  const read = readDraft(draft)
  if (!read.ok) return read.outcome
  if (typeof draft.code !== "string") return promoRefusal("invalid-code")
  const client = await manager()
  if (!client.ok) return promoRefusal(client.error)
  const result = await createPromoCode(client.supabase, { ...read.data, code: typedPromoCode(draft.code) })
  if (!result.ok) return promoRefusal(result.error)
  revalidatePath("/staff/promo-codes")
  return { status: "saved", message: createdMessage(result.data.code) }
}

// `shown` is the code as listed, to word the answer, and what it held when
// the sheet opened, to tell whether its fees moved.
export async function updatePromo(
  id: string,
  draft: PromoDraft,
  reason: string | null,
  shown: { code: string; amount: number; endsOn: string | null },
): Promise<PromoOutcome> {
  if (typeof id !== "string" || typeof shown?.code !== "string") return promoRefusal("not-found")
  const read = readDraft(draft)
  if (!read.ok) return read.outcome
  const why = optional(reason)
  if (why === undefined) return promoRefusal("invalid-reason")
  const client = await manager()
  if (!client.ok) return promoRefusal(client.error)
  const result = await updatePromoCode(client.supabase, id, { ...read.data, reason: why })
  if (!result.ok) return promoRefusal(result.error)
  revalidatePath("/staff/promo-codes")
  const moved = read.data.amount !== shown.amount || read.data.endsOn !== shown.endsOn
  return { status: "saved", message: savedMessage(shown.code, moved, result.data.feeChangeCount) }
}

// Pause, Resume (active) or End, with a reason.
export async function changePromoState(id: string, state: PromoState, reason: string, code: string): Promise<PromoOutcome> {
  if (typeof id !== "string" || typeof code !== "string") return promoRefusal("not-found")
  if (!STATES.includes(state)) return promoRefusal("invalid-state")
  if (typeof reason !== "string" || reason.trim() === "") return promoRefusal("invalid-reason")
  const client = await manager()
  if (!client.ok) return promoRefusal(client.error)
  const result = await setPromoCodeState(client.supabase, id, state, reason.trim())
  if (!result.ok) return promoRefusal(result.error)
  revalidatePath("/staff/promo-codes")
  return { status: "saved", message: stateMessage(code, state) }
}
