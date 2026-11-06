"use server"

import { revalidatePath } from "next/cache"

import { confirmEmailClaim, rejectEmailClaim } from "@/lib/services/agent-email-claims"
import { sendAgentInvite } from "@/lib/services/agent-invites"
import { requirePermission } from "@/lib/services/staff-auth"
import { agentInviteSender } from "@/utils/supabase/admin"
import { createClient } from "@/utils/supabase/server"

import { claimRefusal, confirmedOutcome, type ClaimOutcome } from "./claim-outcome"
import { agentSetPasswordUrl } from "./invite-link"

// Confirm, Reject and Save and send invite on the "Awaiting email
// confirmation" queue (#193). The database checks agents.approve and records
// each decision; Confirm then sends the invite through the #191 path, to the
// email just saved and only while it is still the agent's.

async function approver() {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (allowed.ok) return { ok: true as const, supabase }
  if (allowed.error === "signed-out") return { ok: false as const, error: { kind: "signed-out" as const } }
  if (allowed.error === "unavailable") return { ok: false as const, error: { kind: "unavailable" as const } }
  return { ok: false as const, error: { kind: "forbidden" as const } }
}

// Confirm with the claim's own email, or, with `email`, Save and send invite
// with the address the Manager corrected on the phone.
export async function confirmAgentEmailClaim(claimId: string, agentName: string, email: string | null): Promise<ClaimOutcome> {
  if (typeof claimId !== "string") return { status: "refused", message: claimRefusal({ kind: "not-found" }) }
  if (email !== null && typeof email !== "string") return { status: "refused", message: claimRefusal({ kind: "email-invalid" }) }
  const client = await approver()
  if (!client.ok) return { status: "refused", message: claimRefusal(client.error) }

  const confirmed = await confirmEmailClaim(client.supabase, claimId, email?.trim() ? email : null)
  if (!confirmed.ok) return { status: "refused", message: claimRefusal(confirmed.error) }

  const invite = await sendAgentInvite(client.supabase, agentInviteSender(), confirmed.data.agentId, await agentSetPasswordUrl(), {
    expectedEmail: confirmed.data.email,
  })
  revalidatePath("/staff/agents")
  return confirmedOutcome({ fullName: typeof agentName === "string" ? agentName : "the agent" }, confirmed.data.email, invite)
}

export async function rejectAgentEmailClaim(claimId: string): Promise<ClaimOutcome> {
  if (typeof claimId !== "string") return { status: "refused", message: claimRefusal({ kind: "not-found" }) }
  const client = await approver()
  if (!client.ok) return { status: "refused", message: claimRefusal(client.error) }
  const rejected = await rejectEmailClaim(client.supabase, claimId)
  if (!rejected.ok) return { status: "refused", message: claimRefusal(rejected.error) }
  revalidatePath("/staff/agents")
  return { status: "done", message: "Claim rejected. The record's email stays empty." }
}
