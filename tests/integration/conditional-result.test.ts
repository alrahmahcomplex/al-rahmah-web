import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { getMetricCount } from "@/lib/services/dashboard"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import {
  getInterviewAgreement,
  getLeadInterviews,
  markAgreementSigned,
  recordInterviewResult,
  registerForInterview,
  type InterviewResult,
} from "@/lib/services/interviews"
import { listNextStepFacts } from "@/lib/services/lead-next-steps"
import { createLead, type LeadClass } from "@/lib/services/leads"
import { getLatestResultRelease, releaseResult } from "@/lib/services/result-release"
import { previewPayment } from "@/lib/services/school-fee-payments"

import { asSystem, createThrowawayStaff, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// The Conditional interview result and its agreement (owner decisions of
// 2026-11-27), against local Supabase. Each test makes leads of its own in a
// fee year it claims, so their counts and payments are its own.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))
const OFFICE = { officePhone: "+255 673 526 644" }

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 1_000_003, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

async function claimedYear({ schedule = false } = {}): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  if (schedule) {
    const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
    if (!saved.ok) throw new Error(`setup failed: ${JSON.stringify(saved.error)}`)
  }
  return claim.year
}

function phone() {
  // A leading 04 keeps it clear of the seeded numbers and the other files'.
  return `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in lead in `year`, interviewed with `result`, its interview fee Paid
// when asked.
async function interviewed(
  year: number,
  result: InterviewResult,
  { className = "STD 2", paid = false }: { className?: LeadClass; paid?: boolean } = {},
): Promise<{ leadId: string; interviewId: string }> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Conditional Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Conditional ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  const registered = await registerForInterview(admissions, leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const interviewId = registered.data.interviewId
  if (paid) {
    const marked = await (await signedIn(ACCOUNTANT)).rpc("set_interview_fee_status", { interview_id: interviewId, fee_status: "Paid" })
    if (marked.error) throw new Error(`fee failed: ${marked.error.message}`)
  }
  const recorded = await recordInterviewResult(admissions, interviewId, { interviewDate: today, result, score: 48 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
  return { leadId, interviewId }
}

// A head of school: may view leads and mark agreements, nothing else.
async function headOfSchool() {
  return createThrowawayStaff(["leads.view", "agreements.mark"])
}

describe("recording a Conditional result", () => {
  test("is a result like the others, with its own next action", async () => {
    const year = await claimedYear()
    const { leadId } = await interviewed(year, "Conditional")
    const interviews = await getLeadInterviews(await signedIn(ADMISSIONS), leadId)
    expect(interviews.ok && interviews.data[0]).toMatchObject({
      result: "Conditional",
      score: 48,
      nextAction: "Sign the agreement, then complete enrollment",
      agreementSignedAt: null,
    })
  })

  test("refuses any other result as incomplete", async () => {
    const year = await claimedYear()
    const { interviewId } = await interviewed(year, "Passed")
    const refused = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, {
      interviewDate: today,
      result: "Maybe" as InterviewResult,
      score: 50,
    })
    expect(refused).toEqual({ ok: false, error: "incomplete" })
  })

  test("lets the School fee be paid, the agreement marked or not", async () => {
    const year = await claimedYear({ schedule: true })
    const { leadId } = await interviewed(year, "Conditional")
    const accountant = await signedIn(ACCOUNTANT)
    const preview = await previewPayment(accountant, leadId, { type: "initial_deposit", amount: 300_000, paidOn: today })
    expect(preview).toMatchObject({ ok: true, data: { totalPaidAfter: 300_000 } })

    const failed = await interviewed(year, "Failed")
    expect(await previewPayment(accountant, failed.leadId, { type: "initial_deposit", amount: 300_000, paidOn: today })).toEqual({
      ok: false,
      error: "not_passed",
    })
  })

  test("counts on Reports by itself, apart from Passed and Failed", async () => {
    const year = await claimedYear()
    await interviewed(year, "Conditional")
    await interviewed(year, "Conditional")
    await interviewed(year, "Passed")
    const manager = await signedIn(MANAGER)
    const filters = { period: { kind: "all" } as const, enrollmentYear: year }
    expect(await getMetricCount(manager, "conditional_interviews", filters)).toEqual({ ok: true, data: 2 })
    expect(await getMetricCount(manager, "passed_interviews", filters)).toEqual({ ok: true, data: 1 })
    expect(await getMetricCount(manager, "failed_interviews", filters)).toEqual({ ok: true, data: 0 })
  })

  test("goes out with the Conditional message, and a Failed result with version 2", async () => {
    const year = await claimedYear()
    const staff = await signedIn(ADMISSIONS)
    const conditional = await interviewed(year, "Conditional", { className: "FORM 2", paid: true })
    const sent = await releaseResult(staff, conditional.interviewId, "sms", OFFICE)
    expect(sent.ok && sent.data.channel === "sms" && sent.data.text).toContain("Mkuu wa Shule ya Sekondari")
    expect(await getLatestResultRelease(staff, conditional.interviewId)).toMatchObject({
      ok: true,
      data: { latest: { result: "Conditional", templateId: "sms_conditional_v1" } },
    })

    const failed = await interviewed(year, "Failed", { className: "KG 2", paid: true })
    const sentFailed = await releaseResult(staff, failed.interviewId, "sms", OFFICE)
    expect(sentFailed.ok && sentFailed.data.channel === "sms" && sentFailed.data.text).toContain("+255 677 330 099")
    expect(await getLatestResultRelease(staff, failed.interviewId)).toMatchObject({
      ok: true,
      data: { latest: { result: "Failed", templateId: "sms_failed_v2" } },
    })
  })
})

describe("marking the agreement signed", () => {
  test("is for staff holding agreements.mark, and only once it is Conditional", async () => {
    const year = await claimedYear()
    const { interviewId } = await interviewed(year, "Conditional")
    expect(await markAgreementSigned(await signedIn(ADMISSIONS), interviewId)).toEqual({ ok: false, error: "forbidden" })
    expect(await markAgreementSigned(await signedIn(MANAGER), interviewId)).toEqual({ ok: false, error: "forbidden" })

    const passed = await interviewed(year, "Passed")
    const head = await headOfSchool()
    expect(await markAgreementSigned(await signedIn(head), passed.interviewId)).toEqual({ ok: false, error: "not_conditional" })
    expect(await markAgreementSigned(await signedIn(head), randomUUID())).toEqual({ ok: false, error: "not_found" })
  })

  test("records when and by whom, once, and moves the next step on", async () => {
    const year = await claimedYear()
    const { leadId, interviewId } = await interviewed(year, "Conditional")
    const manager = await signedIn(MANAGER)
    const before = await listNextStepFacts(manager, [leadId])
    expect(before.ok && before.data.get(leadId)?.interview?.agreementSigned).toBe(false)
    expect(await getInterviewAgreement(manager, interviewId)).toEqual({ ok: true, data: null })

    const head = await headOfSchool()
    const asHead = await signedIn(head)
    expect(await markAgreementSigned(asHead, interviewId)).toEqual({ ok: true, data: { alreadySigned: false } })
    expect(await markAgreementSigned(asHead, interviewId)).toEqual({ ok: true, data: { alreadySigned: true } })

    const agreement = await getInterviewAgreement(manager, interviewId)
    expect(agreement).toMatchObject({ ok: true, data: { signedBy: head.name } })
    const interviews = await getLeadInterviews(manager, leadId)
    expect(interviews.ok && interviews.data[0].agreementSignedAt).not.toBeNull()
    const after = await listNextStepFacts(manager, [leadId])
    expect(after.ok && after.data.get(leadId)?.interview?.agreementSigned).toBe(true)

    const history = await getLeadHistory(await signedIn(SUPER_ADMIN), leadId)
    if (!history.ok) throw new Error(`history failed: ${history.error}`)
    const marks = history.data.entries.filter(
      (entry) => entry.record === "interviews" && entry.changes.some((change) => change.field === "agreement_signed_at" && change.to !== null),
    )
    expect(marks).toHaveLength(1)
  })

  test("refuses a closed application", async () => {
    const year = await claimedYear()
    const { leadId, interviewId } = await interviewed(year, "Conditional")
    const head = await headOfSchool()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [leadId]))
    expect(await markAgreementSigned(await signedIn(head), interviewId)).toEqual({ ok: false, error: "lead_closed" })
  })

  test("can't be written straight to the interview by anyone", async () => {
    const year = await claimedYear()
    const { interviewId } = await interviewed(year, "Conditional")
    const head = await headOfSchool()
    const { error } = await (await signedIn(head))
      .from("interviews")
      .update({ agreement_signed_at: new Date().toISOString() })
      .eq("id", interviewId)
    expect(error).not.toBeNull()
  })
})
