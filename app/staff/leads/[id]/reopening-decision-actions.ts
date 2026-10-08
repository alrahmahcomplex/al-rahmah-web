"use server"

import { revalidatePath } from "next/cache"

import { approveReopeningRequest, rejectReopeningRequest } from "@/lib/services/reopening-requests"
import { getStaffUser } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { approveOutcome, canDecideReopening, rejectOutcome, type DecisionOutcome } from "./reopening-decision-outcome"

// Approve and Reject on a Pending Reopening request (#101). Server Actions
// take input from anyone who can post to them, so the shape is checked here,
// and the database then checks the permission, the request's state and the
// retake rule. A retried click repeats the same decision, which the database
// takes as already done.

export async function approveReopeningAction(
  leadId: string,
  requestId: string,
  enrolWithoutRetake: boolean | null,
): Promise<DecisionOutcome> {
  if (typeof leadId !== "string" || typeof requestId !== "string") return approveOutcome("not-found")
  if (enrolWithoutRetake !== null && typeof enrolWithoutRetake !== "boolean") return approveOutcome("invalid")

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !canDecideReopening(staff.data.permissions)) return approveOutcome("forbidden")

  const result = await approveReopeningRequest(supabase, requestId, { enrolWithoutRetake: enrolWithoutRetake ?? undefined })
  if (!result.ok) return approveOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "decided" }
}

export async function rejectReopeningAction(leadId: string, requestId: string, reason: string): Promise<DecisionOutcome> {
  if (typeof leadId !== "string" || typeof requestId !== "string") return rejectOutcome("not-found")
  if (typeof reason !== "string") return rejectOutcome("invalid")

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !canDecideReopening(staff.data.permissions)) return rejectOutcome("forbidden")

  const result = await rejectReopeningRequest(supabase, requestId, { reason })
  if (!result.ok) return rejectOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "decided" }
}
