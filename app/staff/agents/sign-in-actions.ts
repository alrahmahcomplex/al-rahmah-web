"use server"

import { revalidatePath } from "next/cache"

import { getAgentSignIn, removeAgentSignIn, type SignInRemovalError } from "@/lib/services/agent-sign-in-removal"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

// Remove this sign-in (#503, prototype v58 R1 to R3), for staff with
// agents.approve. The database checks the permission and does the removal;
// the check here only words a signed-out session's answer.

const REFUSED: Record<SignInRemovalError | "signed-out" | "uncertain", string> = {
  forbidden: "You don't have permission to remove an agent's sign-in.",
  "not-found": "This agent could not be found. Reload the page and try again.",
  retired: "This agent is retired, so nothing about them can change.",
  "not-joined": "This agent has no sign-in to remove. Reload the page to see them as they are now.",
  unavailable: "The sign-in could not be read just now. Try again in a moment.",
  uncertain: "We lost the answer, so the sign-in may or may not have been removed. Reload the page to check.",
  "signed-out": "Your session has ended. Sign in again, then try again.",
}

export type SignInAnswer = { status: "ready"; signedInWith: string; joinedAt: string | null } | { status: "refused"; message: string }

export async function readAgentSignIn(agentId: string): Promise<SignInAnswer> {
  if (typeof agentId !== "string") return { status: "refused", message: REFUSED["not-found"] }
  const supabase = await createClient()
  const read = await getAgentSignIn(supabase, agentId)
  if (!read.ok) return { status: "refused", message: REFUSED[read.error] }
  return { status: "ready", signedInWith: read.data.signedInWith, joinedAt: read.data.joinedAt }
}

export type RemovalOutcome = { status: "removed"; message: string } | { status: "refused"; message: string }

export async function removeSignIn(agentId: string, closeEmail: boolean): Promise<RemovalOutcome> {
  if (typeof agentId !== "string" || typeof closeEmail !== "boolean") return { status: "refused", message: REFUSED["not-found"] }
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (!allowed.ok) {
    return { status: "refused", message: REFUSED[allowed.error === "signed-out" ? "signed-out" : allowed.error === "unavailable" ? "unavailable" : "forbidden"] }
  }
  const removed = await removeAgentSignIn(supabase, agentId, closeEmail)
  // The row's badge and line change; a lost answer may hide a removal.
  if (removed.ok || removed.error === "uncertain" || removed.error === "not-joined") revalidatePath("/staff", "layout")
  if (!removed.ok) return { status: "refused", message: REFUSED[removed.error] }
  // O-N58.
  return { status: "removed", message: "Sign-in removed." }
}
