import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { approveReopeningRequest, declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, getLead, type LeadStatus } from "@/lib/services/leads"
import { adjustPayment } from "@/lib/services/payment-adjustments"
import { raiseReopeningRequest } from "@/lib/services/reopening-requests"
import { previewPayment, recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Where slice 9 meets slice 8's reopening (#115), through the payments, lead
// closure and reopening modules against local Supabase, signed in as each
// seeded role. Each test makes leads of its own in a year it claims with a
// schedule of its own (tests/support/fee-years.ts); the seeded reopened leads
// are only previewed against.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// slice 8's seed: reopened after a Failed interview, one to enrol without a
// retaken interview and one to retake it.
const SEEDED_ENROL_WITHOUT_RETAKE = "1ead0000-0000-4000-8000-000000000086"
const SEEDED_RETAKE = "1ead0000-0000-4000-8000-000000000087"

// STD 2 Day: TZS 2,000,000.
const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

const DEPOSIT: PaymentInput = { type: "initial_deposit", amount: 300_000, paidOn: today }
const FULL: PaymentInput = { type: "full_payment", amount: 2_000_000, paidOn: today }

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function phone() {
  // A leading 5 keeps it clear of the seeded 700 000 numbers.
  return `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in STD 2 Day lead in `year`, interviewed today with `result`.
async function interviewedLead(year: number, result: "Passed" | "Failed"): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Reopen Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Reopen ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result,
    score: result === "Passed" ? 80 : 40,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return id
}

// Declines the lead, raises a Reopening request and approves it with the
// retake choice.
async function reopened(lead: string, enrolWithoutRetake: boolean, reason: "Did not pass interview" | "Enrolled elsewhere") {
  const declined = await declineLead(await signedIn(MANAGER), lead, { reason })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "The family is back.", source: "lead" })
  if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
  const approved = await approveReopeningRequest(await signedIn(MANAGER), raised.data, { enrolWithoutRetake })
  if (!approved.ok) throw new Error(`approve failed: ${approved.error}`)
}

async function pay(lead: string, payment: PaymentInput) {
  return recordPayment(await signedIn(ACCOUNTANT), lead, payment, randomUUID())
}

async function statusOf(lead: string): Promise<LeadStatus> {
  const read = await getLead(await signedIn(ADMISSIONS), lead)
  if (!read.ok) throw new Error(`no lead: ${read.error}`)
  return read.data.status
}

async function causeOf(lead: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ recompute_cause: string; enrolled_trigger: string | null }>(
      "select recompute_cause, enrolled_trigger from public.lead_fee_profiles where lead_id = $1",
      [lead],
    )
    return rows[0] ?? null
  })
}

describe("payments on a reopened lead", () => {
  test("the seeded lead reopened to enrol without a retaken interview takes a payment, and the one reopened for a retake doesn't", async () => {
    const accountant = await signedIn(ACCOUNTANT)
    expect(await previewPayment(accountant, SEEDED_ENROL_WITHOUT_RETAKE, DEPOSIT)).toMatchObject({ ok: true })
    expect(await previewPayment(accountant, SEEDED_RETAKE, DEPOSIT)).toEqual({ ok: false, error: "not_passed" })
  })

  test("a lead whose interview Failed takes payments once reopened to enrol without a retaken interview", async () => {
    const lead = await interviewedLead(await yearWithSchedule(), "Failed")
    expect(await pay(lead, DEPOSIT)).toEqual({ ok: false, error: "not_passed" })

    await reopened(lead, true, "Did not pass interview")
    expect(await statusOf(lead)).toBe("Interviewed")

    expect(await pay(lead, DEPOSIT)).toMatchObject({ ok: true, data: { totalPaid: 300_000, priority: "Deposit" } })
    // Full enrols it, as for a Passed lead.
    expect(await pay(lead, { ...FULL, type: "second_instalment", amount: 1_700_000 })).toMatchObject({
      ok: true,
      data: { totalPaid: 2_000_000, priority: "Full" },
    })
    expect(await statusOf(lead)).toBe("Enrolled")
  })

  // Registering the retaken interview itself is slice 5's.
  test("a lead whose interview Failed is still refused once reopened for a retake", async () => {
    const lead = await interviewedLead(await yearWithSchedule(), "Failed")
    await reopened(lead, false, "Did not pass interview")

    expect(await statusOf(lead)).toBe("Interviewed")
    expect(await pay(lead, DEPOSIT)).toEqual({ ok: false, error: "not_passed" })
    expect(await previewPayment(await signedIn(ACCOUNTANT), lead, DEPOSIT)).toEqual({ ok: false, error: "not_passed" })
  })

  test("only the latest approved request counts: a later reopening for a retake ends Enrol without a retaken interview", async () => {
    const lead = await interviewedLead(await yearWithSchedule(), "Failed")
    await reopened(lead, true, "Did not pass interview")
    const accountant = await signedIn(ACCOUNTANT)
    expect(await previewPayment(accountant, lead, DEPOSIT)).toMatchObject({ ok: true })

    await reopened(lead, false, "Did not pass interview")
    expect(await previewPayment(accountant, lead, DEPOSIT)).toEqual({ ok: false, error: "not_passed" })
  })
})

describe("Enrolled after a reopening", () => {
  test("a lead declined while Enrolled, then approved back, is Enrolled again from its payments", async () => {
    const lead = await interviewedLead(await yearWithSchedule(), "Passed")
    expect(await pay(lead, FULL)).toMatchObject({ ok: true })
    expect(await statusOf(lead)).toBe("Enrolled")

    await reopened(lead, true, "Enrolled elsewhere")

    expect(await statusOf(lead)).toBe("Enrolled")
    expect(await causeOf(lead)).toEqual({ recompute_cause: "reopening", enrolled_trigger: "payment" })
    const fee = await getLeadFee(await signedIn(ACCOUNTANT), lead)
    expect(fee).toMatchObject({ ok: true, data: { kind: "fee", enrolment: { on: today, by: { kind: "payment", type: "full_payment" } } } })

    // Newest first: the reopening enrolled the lead again, after the
    // approval brought it back as Interviewed.
    const history = await getLeadHistory(await signedIn(ADMISSIONS), lead)
    if (!history.ok) throw new Error(history.error)
    const statuses = history.data.entries
      .filter((entry) => entry.record === "lead")
      .flatMap((entry) => entry.changes.filter((c) => c.field === "status").map((c) => ({ actor: entry.actor, from: c.from, to: c.to })))
    expect(statuses.slice(0, 3)).toEqual([
      { actor: MANAGER.name, from: "Interviewed", to: "Enrolled" },
      { actor: MANAGER.name, from: "Declined", to: "Interviewed" },
      { actor: MANAGER.name, from: "Enrolled", to: "Declined" },
    ])
  })

  test("a lead whose payment was voided while Declined comes back Interviewed, and no longer Enrolled", async () => {
    const lead = await interviewedLead(await yearWithSchedule(), "Passed")
    const paid = await pay(lead, FULL)
    if (!paid.ok) throw new Error(paid.error)
    expect(await declineLead(await signedIn(MANAGER), lead, { reason: "Enrolled elsewhere" })).toEqual({ ok: true, data: null })

    // Adjustments work on a Declined lead; its status stays Declined.
    const voided = await adjustPayment(
      await signedIn(ACCOUNTANT),
      paid.data.paymentId,
      { reason: "Duplicate entry", void: true, note: null },
      randomUUID(),
    )
    expect(voided).toMatchObject({ ok: true })
    expect(await statusOf(lead)).toBe("Declined")

    const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "The family is back.", source: "lead" })
    if (!raised.ok) throw new Error(JSON.stringify(raised.error))
    expect(await approveReopeningRequest(await signedIn(MANAGER), raised.data, { enrolWithoutRetake: false })).toEqual({ ok: true, data: null })

    expect(await statusOf(lead)).toBe("Interviewed")
    expect(await causeOf(lead)).toEqual({ recompute_cause: "reopening", enrolled_trigger: null })
  })

  test("a correction to the class still recomputes as lead details", async () => {
    const lead = await interviewedLead(await yearWithSchedule(), "Passed")
    expect(await pay(lead, FULL)).toMatchObject({ ok: true })
    // FORM 1 Day costs more (TZS 2,800,000), so Full is lost.
    await asSystem((sql) => sql.query("update public.leads set class_name = 'FORM 1' where id = $1", [lead]))
    expect(await statusOf(lead)).toBe("Interviewed")
    expect(await causeOf(lead)).toMatchObject({ recompute_cause: "lead_details" })
  })
})
