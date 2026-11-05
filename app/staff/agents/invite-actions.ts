"use server"

import { revalidatePath } from "next/cache"

import { sendAgentInvite, setAgentEmail } from "@/lib/services/agent-invites"
import { requirePermission } from "@/lib/services/staff-auth"
import { agentInviteSender, agentLogins } from "@/utils/supabase/admin"
import { createClient } from "@/utils/supabase/server"

import { agentSetPasswordUrl } from "./invite-link"
import { emailOutcome, inviteOutcome, type EmailOutcome, type InviteOutcome } from "./invite-outcome"

// Send invite, Resend and Edit email on the Agents screen (#191). The
// database checks agents.approve and the agent's state on the Manager's
// session and records every attempt; only the email itself goes out with
// the secret key.

async function approver() {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (allowed.ok) return { ok: true as const, supabase }
  if (allowed.error === "signed-out") return { ok: false as const, error: { kind: "signed-out" as const } }
  if (allowed.error === "unavailable") return { ok: false as const, error: { kind: "unavailable" as const } }
  return { ok: false as const, error: { kind: "forbidden" as const } }
}

// Sends the invite, or a resend, to `email`, the address the Manager sees on
// the row, and only while it is still the agent's email.
export async function sendMarketingAgentInvite(agentId: string, email: string): Promise<InviteOutcome> {
  if (typeof agentId !== "string" || typeof email !== "string") return inviteOutcome({ ok: false, error: { kind: "not-found" } })
  const client = await approver()
  if (!client.ok) return inviteOutcome(client)
  const result = await sendAgentInvite(client.supabase, agentInviteSender(), agentId, await agentSetPasswordUrl(), {
    expectedEmail: email,
  })
  // Every attempt is recorded, so the badge and its line change either way.
  revalidatePath("/staff/agents")
  return inviteOutcome(result)
}

// Adds or corrects the agent's email. A joined agent's sign-in email changes
// with it, already confirmed, so Supabase sends no confirmation email.
export async function saveMarketingAgentEmail(agentId: string, email: string): Promise<EmailOutcome> {
  if (typeof agentId !== "string") return emailOutcome({ ok: false, error: { kind: "not-found" } })
  if (typeof email !== "string") return emailOutcome({ ok: false, error: { kind: "email-invalid" } })
  const client = await approver()
  if (!client.ok) return emailOutcome(client)
  const result = await setAgentEmail(client.supabase, agentId, email, agentLogins())
  if (result.ok) revalidatePath("/staff/agents")
  return emailOutcome(result)
}
