"use server"

import { revalidatePath } from "next/cache"

import { approveAgent } from "@/lib/services/marketing-agents"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { approveOutcome, type ApproveOutcome } from "./outcome"

// Approves a Pending Marketing Agent. The name and code come from the row the
// Manager confirmed, only to word the answer; the database decides by the id
// and checks agents.approve itself.
export async function approveMarketingAgent(
  agentId: string,
  agent: { fullName: string; code: string },
): Promise<ApproveOutcome> {
  if (typeof agentId !== "string" || typeof agent?.fullName !== "string" || typeof agent?.code !== "string") {
    return approveOutcome({ ok: false, error: "not-found" }, { fullName: "", code: "" })
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (!allowed.ok) {
    const error = allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : "forbidden"
    return approveOutcome({ ok: false, error }, agent)
  }

  const result = await approveAgent(supabase, agentId)
  // The list and the Pending count in the navigation both change.
  if (result.ok || result.error === "no-change") revalidatePath("/staff", "layout")
  return approveOutcome(result.ok ? { ok: true } : result, agent)
}
