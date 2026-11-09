"use server"

import { revalidatePath } from "next/cache"

import {
  AGENT_STATUS_ACTIONS,
  approveAgent,
  changeAgentStatus,
  checkNewAgent,
  createAgent,
  getAgentFeeImpact,
  getRecreatePreview,
  recreateAgent,
  type AgentCheck,
  type AgentConflict,
  type AgentDraft,
  type AgentStatusAction,
  type FeeImpact,
  type RecreatePreview,
} from "@/lib/services/marketing-agents"
import { sendAgentInvite } from "@/lib/services/agent-invites"
import { requirePermission } from "@/lib/services/staff-auth"
import { agentInviteSender } from "@/utils/supabase/admin"
import { createClient } from "@/utils/supabase/server"

import { agentSetPasswordUrl } from "./invite-link"
import { approvedWithInvite, type ApprovedOutcome } from "./invite-outcome"

import {
  approveOutcome,
  createdMessage,
  createRefusal,
  recreatedMessage,
  recreateRefusal,
  STATUS_REASON_MAX,
  statusOutcome,
  type ApproveOutcome,
  type DraftRefusal,
  type StatusOutcome,
} from "./outcome"

// Approves a Pending Marketing Agent. The name and code come from the row the
// Manager confirmed, only to word the answer; the database decides by the id
// and checks agents.approve itself. Then the invite goes to `email`, the
// address the Manager saw in the dialog (#191); approval stands whatever the
// email does.
export async function approveMarketingAgent(
  agentId: string,
  agent: { fullName: string; code: string },
  email: string | null = null,
): Promise<ApproveOutcome | ApprovedOutcome> {
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
  if (!result.ok) return approveOutcome(result, agent)

  const invite =
    typeof email === "string" && email.trim() !== ""
      ? await sendAgentInvite(supabase, agentInviteSender(), agentId, await agentSetPasswordUrl(), { expectedEmail: email })
      : ({ ok: false, error: { kind: "no-email" } } as const)
  return approvedWithInvite(agent, invite)
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
  // The list, the Pending count (retiring a Pending agent) and every lead's
  // fee may change. A lost answer may hide a saved change.
  if (result.ok || result.error === "no-change" || result.error === "retired" || result.error === "uncertain") {
    revalidatePath("/staff", "layout")
  }
  return statusOutcome(result, action, words)
}

// ---------------------------------------------------------------------------
// Creating an agent, and Recreate (#189). The database checks agents.approve
// itself; the check here only words a signed-out session's answer.
// ---------------------------------------------------------------------------

export type AgentDraftInput = { fullName: string; phone: string; whatsapp: string; email: string; code: string }

function draftOf(input: AgentDraftInput | undefined): AgentDraft {
  const text = (value: unknown) => (typeof value === "string" ? value : "")
  return { fullName: text(input?.fullName), phone: text(input?.phone), whatsapp: text(input?.whatsapp), email: text(input?.email), code: text(input?.code) }
}

async function approverClient() {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (allowed.ok) return { ok: true as const, supabase }
  return { ok: false as const, error: allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : ("forbidden" as const) }
}

export type CheckAnswer =
  | { status: "ready"; check: Extract<AgentCheck, { kind: "ready" }> }
  | { status: "conflict"; conflict: AgentConflict }
  | ({ status: "refused" } & DraftRefusal)

// What the Manager checks before saving. Saves nothing.
export async function checkNewMarketingAgent(input: AgentDraftInput): Promise<CheckAnswer> {
  const client = await approverClient()
  if (!client.ok) return { status: "refused", ...createRefusal({ kind: client.error }) }
  const result = await checkNewAgent(client.supabase, draftOf(input))
  if (!result.ok) return { status: "refused", ...createRefusal(result.error) }
  if (result.data.kind === "ready") return { status: "ready", check: result.data }
  return { status: "conflict", conflict: result.data }
}

export type CreateAnswer = { status: "created"; message: string } | { status: "conflict"; conflict: AgentConflict } | ({ status: "refused" } & DraftRefusal)

// The Manager's create: Approved at once.
export async function createMarketingAgent(input: AgentDraftInput): Promise<CreateAnswer> {
  const client = await approverClient()
  if (!client.ok) return { status: "refused", ...createRefusal({ kind: client.error }) }
  const result = await createAgent(client.supabase, draftOf(input))
  // Only the agents list changes. A created agent is Approved at once, so no
  // count in the navigation moves (nav-counts.ts): the Pending count drops
  // only on approve, retire or Recreate, which refresh the whole staff side.
  if (!result.ok) {
    if (result.error.kind === "uncertain") revalidatePath("/staff/agents")
    return { status: "refused", ...createRefusal(result.error) }
  }
  if (result.data.kind !== "created") return { status: "conflict", conflict: result.data }
  revalidatePath("/staff/agents")
  return { status: "created", message: createdMessage(result.data.agent) }
}

export type RecreatePreviewAnswer = { status: "ready"; preview: RecreatePreview } | { status: "refused"; message: string }

// The record, its student count and the families whose fee the Recreate moves.
export async function readRecreatePreview(agentId: string): Promise<RecreatePreviewAnswer> {
  if (typeof agentId !== "string") return { status: "refused", message: recreateRefusal({ kind: "not-found" }).message }
  const result = await getRecreatePreview(await createClient(), agentId)
  if (result.ok) return { status: "ready", preview: result.data }
  return { status: "refused", message: recreateRefusal(result.error).message }
}

export type RecreateAnswer = { status: "recreated"; message: string } | ({ status: "refused" } & DraftRefusal)

// Recreate, with the corrected details and the Manager's reason. The screen
// asks the Manager to confirm it is the same person first.
export async function recreateMarketingAgent(agentId: string, input: AgentDraftInput, reason: string): Promise<RecreateAnswer> {
  if (typeof agentId !== "string") return { status: "refused", ...recreateRefusal({ kind: "not-found" }) }
  if (typeof reason !== "string" || reason.trim() === "" || reason.trim().length > STATUS_REASON_MAX) {
    return { status: "refused", ...recreateRefusal({ kind: "invalid", field: "reason" }) }
  }
  const client = await approverClient()
  if (!client.ok) return { status: "refused", ...recreateRefusal({ kind: client.error }) }
  const { fullName, phone, whatsapp, email } = draftOf(input)
  const result = await recreateAgent(client.supabase, agentId, { fullName, phone, whatsapp, email }, reason)
  // Recreating a Pending agent retires it, so the Pending count can drop.
  if (!result.ok) {
    if (result.error.kind === "uncertain") revalidatePath("/staff", "layout")
    return { status: "refused", ...recreateRefusal(result.error) }
  }
  revalidatePath("/staff", "layout")
  return { status: "recreated", message: recreatedMessage(result.data) }
}
