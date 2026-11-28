"use server"

import { OFFICE_PHONE } from "@/lib/office"
import { tanzaniaToday } from "@/lib/school-calendar"
import { getInterviewAgreement, getLeadInterviews, type InterviewFeeStatus, type InterviewResult } from "@/lib/services/interviews"
import { getResultRelease, listReleaseStatus } from "@/lib/services/result-release"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { blockedText, changedSinceSentText, releaseLine } from "../applicants/[id]/result-release-outcome"

// What the Interviews list's side sheet shows of one interview: the record's
// Interview tab, read when the sheet opens (prototype 1MpUKuX27V6pc1CS1z1URz
// v5). Read on the caller's session, so row-level security still decides.

export type SheetInterview = {
  id: string
  serialNumber: number
  enrollmentYear: number
  // "YYYY-MM-DD" in Tanzania: the earliest interview date.
  registeredOn: string
  interviewDate: string | null
  result: InterviewResult | null
  score: number | null
  nextAction: string | null
  feeStatus: InterviewFeeStatus
  amount: number
  discountApplied: boolean
  // For a Conditional result: the day its agreement was marked signed, and by whom.
  agreementSignedOn: string | null
  agreementSignedBy: string | null
}

export type SheetDetails = {
  interview: SheetInterview
  // Whether it is the lead's current interview; only that one's result goes to the family.
  current: boolean
  // The Result release line: sent, why it can't go, or ready to send.
  release: { text: string; sent: boolean } | null
  // The lead's other interviews, newest first.
  others: { id: string; serialNumber: number; enrollmentYear: number; result: InterviewResult | null; score: number | null }[]
}

export type SheetOutcome = { ok: true; details: SheetDetails } | { ok: false; message: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const UNAVAILABLE = "This interview could not be loaded. Try again in a moment."

export async function loadInterviewSheet(leadId: string, interviewId: string): Promise<SheetOutcome> {
  if (typeof leadId !== "string" || typeof interviewId !== "string" || !UUID.test(leadId) || !UUID.test(interviewId)) {
    return { ok: false, message: "This interview could not be found." }
  }
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.view")
  if (!allowed.ok) return { ok: false, message: "You don't have access to interviews." }

  const [interviews, status] = await Promise.all([getLeadInterviews(supabase, leadId), listReleaseStatus(supabase, [interviewId])])
  if (!interviews.ok || !status.ok) return { ok: false, message: UNAVAILABLE }
  const found = interviews.data.find((each) => each.id === interviewId)
  if (!found) return { ok: false, message: "This interview could not be found." }
  const current = interviews.data[0]?.id === interviewId

  const agreement = found.result === "Conditional" && found.agreementSignedAt !== null ? await getInterviewAgreement(supabase, found.id) : null
  let release: SheetDetails["release"] = null
  if (current) {
    const view = await getResultRelease(supabase, leadId, { officePhone: OFFICE_PHONE })
    if (!view.ok) return { ok: false, message: UNAVAILABLE }
    const state = status.data.get(interviewId)
    const last = view.data.latestRelease
    if (view.data.blocked !== null) release = { text: blockedText(view.data.blocked, view.data.amountOwed), sent: false }
    else if (last && state?.changedSinceSent) release = { text: changedSinceSentText(last), sent: false }
    else if (last) release = { text: releaseLine(last), sent: true }
    else release = { text: "Ready to send. Send it from the full record, where the message is shown first.", sent: false }
  }

  return {
    ok: true,
    details: {
      interview: {
        id: found.id,
        serialNumber: found.serialNumber,
        enrollmentYear: found.enrollmentYear,
        registeredOn: tanzaniaToday(new Date(found.registeredAt)),
        interviewDate: found.interviewDate,
        result: found.result,
        score: found.score,
        nextAction: found.nextAction,
        feeStatus: found.feeStatus,
        amount: found.amount,
        discountApplied: found.discountApplied,
        agreementSignedOn: found.agreementSignedAt === null ? null : tanzaniaToday(new Date(found.agreementSignedAt)),
        agreementSignedBy: agreement?.ok ? (agreement.data?.signedBy ?? null) : null,
      },
      current,
      release,
      others: interviews.data
        .filter((each) => each.id !== interviewId)
        .map((each) => ({ id: each.id, serialNumber: each.serialNumber, enrollmentYear: each.enrollmentYear, result: each.result, score: each.score })),
    },
  }
}
