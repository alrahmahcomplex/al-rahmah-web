"use server"

import { revalidatePath } from "next/cache"

import { declineLead, isDeclinedReason } from "@/lib/services/lead-closure"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { declineOutcome, type DeclineOutcome } from "./decline-outcome"

// Declines the lead. Server Actions take input from anyone who can post to
// them, so the shape is checked here, and the database then checks the rules
// and the permissions, No seat available's included.
export async function declineLeadAction(leadId: string, reason: string, explanation: string): Promise<DeclineOutcome> {
  if (typeof leadId !== "string") return declineOutcome("not-found")
  if (!isDeclinedReason(reason) || typeof explanation !== "string") return declineOutcome("invalid")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.decline")
  if (!allowed.ok) return declineOutcome("forbidden")

  const result = await declineLead(supabase, leadId, { reason, explanation })
  if (!result.ok) return declineOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "declined" }
}
