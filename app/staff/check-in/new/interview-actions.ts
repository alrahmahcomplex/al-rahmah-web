"use server"

import { registerForInterview } from "@/lib/services/interviews"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { registeredOutcome, registerOutcome, type RegisterOutcome } from "../../applicants/[id]/interview-outcome"

// What the finished screen is told. "already" is a student someone else put on
// the interview list since the form was saved: the screen shows it as done.
export type FinishRegisterOutcome = RegisterOutcome | { status: "already" }

// Register for interview on the finished screen of Register students and
// Check-in (#511). Unlike the record page's action it revalidates nothing:
// revalidating re-renders the current route, and a checked-in family's
// Check-in page then redirects to the record, which would close the finish
// screen. Staff pages render per request, so the record is fresh when opened.
export async function registerInterviewFromFinish(leadId: string): Promise<FinishRegisterOutcome> {
  if (typeof leadId !== "string") return registerOutcome("not_found")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "interviews.record")
  if (!allowed.ok) return registerOutcome("forbidden")

  const result = await registerForInterview(supabase, leadId)
  if (!result.ok) return result.error === "already_registered" ? { status: "already" } : registerOutcome(result.error)
  return registeredOutcome(result.data)
}
