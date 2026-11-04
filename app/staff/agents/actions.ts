"use server"

import { revalidatePath } from "next/cache"

import {
  AGENT_STATUS_ACTIONS,
  approveAgent,
  changeAgentStatus,
  getAgentFeeImpact,
  type AgentStatusAction,
  type FeeImpact,
} from "@/lib/services/marketing-agents"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { approveOutcome, STATUS_REASON_MAX, statusOutcome, type ApproveOutcome, type StatusOutcome } from "./outcome"

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

function isAction(action: unknown): action is AgentStatusAction {
  return typeof action === "string" && (AGENT_STATUS_ACTIONS as readonly string[]).includes(action)
}

export type FeeImpactAnswer = { status: "ready"; impact: FeeImpact } | { status: "refused"; message: string }

// The families whose interview fee the action would move, for the dialog.
// The database checks agents.approve and leads.view itself.
export async function readAgentFeeImpact(agentId: string, action: AgentStatusAction): Promise<FeeImpactAnswer> {
  if (typeof agentId !== "string" || !isAction(action)) {
    return { status: "refused", message: statusOutcome({ ok: false, error: "not-found" }, "switch-off", { fullName: "", code: "" }).message }
  }
  const supabase = await createClient()
  const result = await getAgentFeeImpact(supabase, agentId, action)
  if (result.ok) return { status: "ready", impact: result.data }
  return { status: "refused", message: statusOutcome(result, action, { fullName: "", code: "" }).message }
}

// Switches an agent off or on, or retires them, with the Manager's reason.
// The name and code only word the answer; the database decides by the id
// and checks agents.approve itself.
export async function changeMarketingAgentStatus(
  agentId: string,
  action: AgentStatusAction,
  reason: string,
  agent: { fullName: string; code: string },
): Promise<StatusOutcome> {
  const words = { fullName: typeof agent?.fullName === "string" ? agent.fullName : "", code: typeof agent?.code === "string" ? agent.code : "" }
  if (typeof agentId !== "string" || !isAction(action)) return statusOutcome({ ok: false, error: "not-found" }, "switch-off", words)
  if (typeof reason !== "string" || reason.trim() === "" || reason.trim().length > STATUS_REASON_MAX) {
    return statusOutcome({ ok: false, error: "invalid-reason" }, action, words)
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (!allowed.ok) {
    const error = allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : "forbidden"
    return statusOutcome({ ok: false, error }, action, words)
  }

  const result = await changeAgentStatus(supabase, agentId, action, reason)
  // The list, the Pending count and every lead's fee may change.
  if (result.ok || result.error === "no-change" || result.error === "retired") revalidatePath("/staff", "layout")
  return statusOutcome(result, action, words)
}
