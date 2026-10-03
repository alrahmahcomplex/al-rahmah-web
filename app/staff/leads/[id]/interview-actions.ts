"use server"

import { revalidatePath } from "next/cache"

import { registerForInterview } from "@/lib/services/interviews"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { registeredOutcome, registerOutcome, type RegisterOutcome } from "./interview-outcome"

// Registers the lead for interview. Server Actions take input from anyone who
// can post to them, so the shape is checked here, and the database then
// checks the rules and the permission.
export async function registerInterview(leadId: string): Promise<RegisterOutcome> {
  if (typeof leadId !== "string") return registerOutcome("not_found")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "interviews.record")
  if (!allowed.ok) return registerOutcome("forbidden")

  const result = await registerForInterview(supabase, leadId)
  if (!result.ok) return registerOutcome(result.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return registeredOutcome(result.data)
}
