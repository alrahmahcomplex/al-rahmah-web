"use server"

import { revalidatePath } from "next/cache"

import {
  markAgreementSigned,
  recordInterviewResult,
  registerForInterview,
  setInterviewFeeStatus,
  type FeeStatusInput,
  type InterviewResult,
  type InterviewResultInput,
} from "@/lib/services/interviews"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import {
  agreementMarkedOutcome,
  agreementOutcome,
  feeChangedOutcome,
  feeOutcome,
  recordedOutcome,
  recordOutcome,
  registeredOutcome,
  registerOutcome,
  type AgreementOutcome,
  type FeeOutcome,
  type RecordOutcome,
  type RegisterOutcome,
} from "./interview-outcome"

// Server Actions take input from anyone who can post to them, so the shape is
// checked here, and the database then checks the rules and the permission.

const RESULTS: ReadonlySet<unknown> = new Set<InterviewResult>(["Passed", "Conditional", "Failed"])

// Registers the lead for interview.
export async function registerInterview(leadId: string): Promise<RegisterOutcome> {
  if (typeof leadId !== "string") return registerOutcome("not_found")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "interviews.record")
  if (!allowed.ok) return registerOutcome("forbidden")

  const result = await registerForInterview(supabase, leadId)
  if (!result.ok) return registerOutcome(result.error)
  revalidatePath(`/staff/applicants/${leadId}`)
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
    !RESULTS.has(input.result) ||
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
  revalidatePath(`/staff/applicants/${leadId}`)
  // The Interviews list shows the result and the fee too, and its side sheet records them.
  revalidatePath("/staff/interviews")
  return recordedOutcome(recorded.data)
}

// Marks the interview fee Paid or Not Paid. There is no amount to send: the
// database locks the fee as it comes to at that moment.
export async function setFeeStatus(leadId: string, interviewId: string, status: FeeStatusInput): Promise<FeeOutcome> {
  if (typeof leadId !== "string" || typeof interviewId !== "string") return feeOutcome("not_found")
  if (status !== "paid" && status !== "not_paid") return feeOutcome("unavailable")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "interview_payments.record")
  if (!allowed.ok) return feeOutcome("forbidden")

  const changed = await setInterviewFeeStatus(supabase, interviewId, status)
  if (!changed.ok) return feeOutcome(changed.error)
  revalidatePath(`/staff/applicants/${leadId}`)
  // The Interviews list shows the result and the fee too, and its side sheet records them.
  revalidatePath("/staff/interviews")
  return feeChangedOutcome(changed.data)
}

// Marks the agreement of a Conditional result signed: the heads of school,
// who hold the agreements, do it with agreements.mark.
export async function markAgreement(leadId: string, interviewId: string): Promise<AgreementOutcome> {
  if (typeof leadId !== "string" || typeof interviewId !== "string") return agreementOutcome("not_found")

  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agreements.mark")
  if (!allowed.ok) return agreementOutcome("forbidden")

  const marked = await markAgreementSigned(supabase, interviewId)
  if (!marked.ok) return agreementOutcome(marked.error)
  revalidatePath(`/staff/applicants/${leadId}`)
  // The Interviews list shows the result and the fee too, and its side sheet records them.
  revalidatePath("/staff/interviews")
  return agreementMarkedOutcome(marked.data)
}
