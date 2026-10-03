"use server"

import { revalidatePath } from "next/cache"

import { recordInterviewResult, registerForInterview, type InterviewResultInput } from "@/lib/services/interviews"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import {
  recordedOutcome,
  recordOutcome,
  registeredOutcome,
  registerOutcome,
  type RecordOutcome,
  type RegisterOutcome,
} from "./interview-outcome"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

// Registers the lead for interview.
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

// Records the interview's result, or corrects it.
export async function recordResult(
  leadId: string,
  interviewId: string,
  input: InterviewResultInput,
): Promise<RecordOutcome> {
  if (typeof leadId !== "string" || typeof interviewId !== "string") return recordOutcome("not_found")
  if (
    typeof input?.interviewDate !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.interviewDate) ||
    (input.result !== "Passed" && input.result !== "Failed") ||
    typeof input.score !== "number" ||
    !Number.isFinite(input.score)
  ) {
    return recordOutcome("incomplete")
  }

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "interviews.record")
  if (!allowed.ok) return recordOutcome("forbidden")

  const recorded = await recordInterviewResult(supabase, interviewId, {
    interviewDate: input.interviewDate,
    result: input.result,
    score: input.score,
  })
  if (!recorded.ok) return recordOutcome(recorded.error)
  revalidatePath(`/staff/leads/${leadId}`)
  return recordedOutcome(recorded.data)
}
