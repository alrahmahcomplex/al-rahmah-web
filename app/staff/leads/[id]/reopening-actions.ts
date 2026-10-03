"use server"

import { revalidatePath } from "next/cache"

import { isReopeningSource, raiseReopeningRequest, withdrawReopeningRequest } from "@/lib/services/reopening-requests"
import { getStaffUser } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { canRaiseReopening, raiseOutcome, withdrawOutcome, type RaiseOutcome, type WithdrawOutcome } from "./reopening-outcome"

// Request reopening and Withdraw. Server Actions take input from anyone who
// can post to them, so the shape is checked here, and the database then
// checks the rules and the permissions, the requester-only withdrawal
// included.

export async function raiseReopeningAction(leadId: string, reason: string, source: string): Promise<RaiseOutcome> {
  if (typeof leadId !== "string") return raiseOutcome({ kind: "not-found" })
  if (typeof reason !== "string" || !isReopeningSource(source)) return raiseOutcome({ kind: "invalid" })

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !canRaiseReopening(staff.data.permissions)) return raiseOutcome({ kind: "forbidden" })

  const result = await raiseReopeningRequest(supabase, leadId, { reason, source })
  if (!result.ok) return raiseOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "raised" }
}

export async function withdrawReopeningAction(leadId: string, requestId: string): Promise<WithdrawOutcome> {
  if (typeof leadId !== "string" || typeof requestId !== "string") return withdrawOutcome("not-found")

  const supabase = await createClient()
  const staff = await getStaffUser(supabase)
  if (!staff.ok || !canRaiseReopening(staff.data.permissions)) return withdrawOutcome("forbidden")

  const result = await withdrawReopeningRequest(supabase, requestId)
  if (!result.ok) return withdrawOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return { status: "withdrawn" }
}
