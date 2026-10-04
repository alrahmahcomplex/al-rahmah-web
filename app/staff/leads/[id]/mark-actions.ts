"use server"

import { revalidatePath } from "next/cache"

import { isClosureReason, isMarkMove, markLead } from "@/lib/services/lead-closure"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { markOutcome, type MarkOutcome } from "./mark-outcome"

// Marks the lead Inactive or Archived. Server Actions take input from anyone
// who can post to them, so the shape is checked here, and the database then
// checks the permission and which moves the lead still allows.
export async function markLeadAction(leadId: string, mark: string, reason: string, note: string): Promise<MarkOutcome> {
  if (typeof leadId !== "string") return markOutcome("not-found")
  if (!isMarkMove(mark) || !isClosureReason(reason) || typeof note !== "string") return markOutcome("invalid")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.close")
  if (!allowed.ok) return markOutcome("forbidden")

  const result = await markLead(supabase, leadId, { mark, reason, note })
  if (!result.ok) return markOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "marked" }
}
