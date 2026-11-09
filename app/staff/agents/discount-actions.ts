"use server"

import { revalidatePath } from "next/cache"

import {
  getAgentDiscountImpact,
  getStandardDiscountImpact,
  setAgentDiscount,
  setStandardDiscount,
  validAmount,
} from "@/lib/services/discount-codes"
import type { FeeImpactFamily } from "@/lib/services/marketing-agents"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import {
  agentDiscountOutcome,
  discountRefusal,
  impactRefusal,
  standardDiscountOutcome,
  type DiscountOutcome,
} from "./discount-outcome"

// The discount sheets on Marketing Agents: the families a new amount would
// move, and Save. Server Actions take input from anyone who can post to
// them, so the shapes are checked here; the database then checks
// discount_codes.manage, the amount and the reason itself.

export type ImpactAnswer = { status: "ready"; families: FeeImpactFamily[] } | { status: "refused"; message: string }

async function manager() {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "discount_codes.manage")
  if (allowed.ok) return { ok: true as const, supabase }
  const error: "signed-out" | "unavailable" | "forbidden" =
    allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : "forbidden"
  return { ok: false as const, error }
}

const amountOrNull = (amount: unknown): amount is number | null => amount === null || validAmount(amount)

export async function readAgentDiscountImpact(agentId: string, amount: number | null): Promise<ImpactAnswer> {
  if (typeof agentId !== "string") return { status: "refused", message: impactRefusal("not-found") }
  if (!amountOrNull(amount)) return { status: "refused", message: impactRefusal("invalid-amount") }
  const client = await manager()
  if (!client.ok) return { status: "refused", message: impactRefusal(client.error) }
  const result = await getAgentDiscountImpact(client.supabase, agentId, amount)
  return result.ok ? { status: "ready", families: result.data } : { status: "refused", message: impactRefusal(result.error) }
}

// Null puts the agent back on the standard; `standard` words the answer.
export async function saveAgentDiscount(
  agentId: string,
  amount: number | null,
  reason: string,
  shown: { code: string; standard: number },
): Promise<DiscountOutcome> {
  if (typeof agentId !== "string" || typeof shown?.code !== "string" || typeof shown?.standard !== "number") {
    return { status: "refused", message: discountRefusal("not-found") }
  }
  if (!amountOrNull(amount)) return { status: "refused", message: discountRefusal("invalid-amount") }
  if (typeof reason !== "string" || reason.trim() === "") return { status: "refused", message: discountRefusal("invalid-reason") }
  const client = await manager()
  if (!client.ok) return { status: "refused", message: discountRefusal(client.error) }
  const result = await setAgentDiscount(client.supabase, agentId, amount, reason.trim())
  // No sidebar count follows an amount. The Promo code sheet compares with
  // the highest agent amount.
  if (result.ok) {
    revalidatePath("/staff/agents")
    revalidatePath("/staff/promo-codes")
  }
  return agentDiscountOutcome(result, shown.code, amount ?? shown.standard)
}

export async function readStandardDiscountImpact(amount: number): Promise<ImpactAnswer> {
  if (!validAmount(amount)) return { status: "refused", message: impactRefusal("invalid-amount") }
  const client = await manager()
  if (!client.ok) return { status: "refused", message: impactRefusal(client.error) }
  const result = await getStandardDiscountImpact(client.supabase, amount)
  return result.ok ? { status: "ready", families: result.data } : { status: "refused", message: impactRefusal(result.error) }
}

export async function saveStandardDiscount(amount: number, reason: string): Promise<DiscountOutcome> {
  if (!validAmount(amount)) return { status: "refused", message: discountRefusal("invalid-amount") }
  if (typeof reason !== "string" || reason.trim() === "") return { status: "refused", message: discountRefusal("invalid-reason") }
  const client = await manager()
  if (!client.ok) return { status: "refused", message: discountRefusal(client.error) }
  const result = await setStandardDiscount(client.supabase, amount, reason.trim())
  if (result.ok) {
    revalidatePath("/staff/agents")
    revalidatePath("/staff/promo-codes")
  }
  return standardDiscountOutcome(result, amount)
}
