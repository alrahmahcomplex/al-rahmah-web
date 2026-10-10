import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { decideDiscount, requestDiscount } from "@/lib/services/discounts"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { markLead } from "@/lib/services/lead-closure"
import { getLeadFee, type PreFormOne } from "@/lib/services/lead-fees"
import { createLead, getLead, updateLeadDetails, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"
import { adjustPayment, type AdjustmentInput } from "@/lib/services/payment-adjustments"
import { setPreFormOne } from "@/lib/services/pre-form-one"
import { listPayments, previewPayment, recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { anonClient, asSystem, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The Pre-Form One programme and its fee (#114) through the fees module,
// against local Supabase, signed in as each seeded role. Each test makes
// leads of its own, Passed in a year it claims with a schedule of its own
// (tests/support/fee-years.ts).

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// FORM 1 Day: TZS 2,800,000, so First instalment from 1,120,000 and Deposit
// from 300,000. The Pre-Form One fee is 450,000 Day and 580,000 Boarding.
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

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`setup failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function phone() {
  // 0598 keeps it clear of the seeded 700 000 numbers and of the other test
  // files' numbers.
  return `0598${String(randomInt(0, 1_000_000)).padStart(6, "0")}`
}

// A walk-in lead in its own year, interviewed and Passed today.
async function passedLead(className: LeadClass = "FORM 1", dayOrBoarding: DayOrBoarding = "Day"): Promise<string> {
  const year = await yearWithSchedule()
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Programme Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Programme ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result: "Passed",
    score: 80,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return id
}

async function tick(leadId: string, ticked = true) {
  return setPreFormOne(await signedIn(ADMISSIONS), leadId, ticked)
}

function payment(type: PaymentInput["type"], amount: number): PaymentInput {
  return { type, amount, paidOn: today }
}

async function record(leadId: string, input: PaymentInput) {
  return recordPayment(await signedIn(ACCOUNTANT), leadId, input, randomUUID())
}

async function pay(leadId: string, input: PaymentInput): Promise<string> {
  const recorded = await record(leadId, input)
  if (!recorded.ok) throw new Error(`payment failed: ${recorded.error}`)
  return recorded.data.paymentId
}

async function feeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data
}

async function programmeOf(leadId: string): Promise<PreFormOne> {
  return (await feeOf(leadId)).preFormOne
}

async function storedTick(leadId: string): Promise<boolean | null> {
  return asSystem(
    async (sql) =>
      (await sql.query<{ pre_form_one: boolean }>("select pre_form_one from public.lead_fee_profiles where lead_id = $1", [leadId]))
        .rows[0]?.pre_form_one ?? null,
  )
}

describe("the Pre-Form One tick", () => {
  test("is accepted on a FORM 1 lead, and the fee shows apart from the School fee", async () => {
    const id = await passedLead("FORM 1", "Boarding")
    expect(await programmeOf(id)).toEqual({ ticked: false, offered: true, applies: false, fee: 580_000, paid: 0, balance: 580_000 })

    expect(await tick(id)).toEqual({ ok: true, data: null })
    expect(await programmeOf(id)).toEqual({ ticked: true, offered: true, applies: true, fee: 580_000, paid: 0, balance: 580_000 })
    // The same tick again changes nothing; clearing takes it off.
    expect(await tick(id)).toEqual({ ok: true, data: null })
    expect(await tick(id, false)).toEqual({ ok: true, data: null })
    expect(await programmeOf(id)).toMatchObject({ ticked: false, applies: false })
  })

  test("is refused off FORM 1, and records nothing", async () => {
    for (const className of ["STD 7", "FORM 2", "KG 1"] as const) {
      const id = await passedLead(className)
      expect(await tick(id), className).toEqual({ ok: false, error: "not-form-one" })
      expect(await storedTick(id), className).toBeNull()
      expect(await programmeOf(id), className).toMatchObject({ ticked: false, offered: false, applies: false })
    }
  })

  test("needs leads.edit, and a lead that exists", async () => {
    const id = await passedLead()
    expect(await setPreFormOne(await signedIn(ACCOUNTANT), id, true)).toEqual({ ok: false, error: "forbidden" })
    expect(await setPreFormOne(anonClient(), id, true)).toEqual({ ok: false, error: "forbidden" })
    expect(await setPreFormOne(await signedIn(MANAGER), id, true)).toEqual({ ok: true, data: null })
    expect(await tick(randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await tick("not-a-lead")).toEqual({ ok: false, error: "not-found" })
  })

  test("stays recorded but stops applying after a class correction, and applies again back in FORM 1", async () => {
    const id = await passedLead()
    expect((await tick(id)).ok).toBe(true)
    const admissions = await signedIn(ADMISSIONS)

    expect((await updateLeadDetails(admissions, id, { className: "FORM 2" })).ok).toBe(true)
    expect(await programmeOf(id)).toEqual({ ticked: true, offered: false, applies: false, fee: 450_000, paid: 0, balance: 450_000 })
    expect(await storedTick(id)).toBe(true)
    // While off FORM 1 a Pre-Form One fee is refused, and the tick can't be
    // set again, though it can be cleared.
    expect(await record(id, payment("pre_form_one_fee", 200_000))).toEqual({ ok: false, error: "not_pre_form_one" })
    expect(await previewPayment(await signedIn(ACCOUNTANT), id, payment("pre_form_one_fee", 200_000))).toEqual({
      ok: false,
      error: "not_pre_form_one",
    })

    expect((await updateLeadDetails(admissions, id, { className: "FORM 1" })).ok).toBe(true)
    expect(await programmeOf(id)).toMatchObject({ ticked: true, offered: true, applies: true })
    expect((await record(id, payment("pre_form_one_fee", 200_000))).ok).toBe(true)

    expect((await updateLeadDetails(admissions, id, { className: "FORM 3" })).ok).toBe(true)
    expect(await tick(id, false)).toEqual({ ok: true, data: null })
    expect(await tick(id)).toEqual({ ok: false, error: "not-form-one" })
    // The payment made while it applied still shows.
    expect(await programmeOf(id)).toEqual({ ticked: false, offered: false, applies: false, fee: 450_000, paid: 200_000, balance: 250_000 })
  })

  test("is refused on a closed lead", async () => {
    const id = await passedLead()
    const marked = await markLead(await signedIn(MANAGER), id, { mark: "archived", reason: "Admission cycle ended" })
    expect(marked.ok).toBe(true)
    expect(await tick(id)).toEqual({ ok: false, error: "lead-closed" })
    expect(await storedTick(id)).toBeNull()
  })
})

describe("a Pre-Form One fee payment", () => {
  test("is refused without the tick", async () => {
    const id = await passedLead()
    expect(await record(id, payment("pre_form_one_fee", 450_000))).toEqual({ ok: false, error: "not_pre_form_one" })
    expect(await previewPayment(await signedIn(ACCOUNTANT), id, payment("pre_form_one_fee", 450_000))).toEqual({
      ok: false,
      error: "not_pre_form_one",
    })
    expect(await listPayments(await signedIn(ADMISSIONS), id)).toEqual({ ok: true, data: [] })
  })

  test("keeps its own paid amount and balance, apart from the School fee, with no discount on the programme fee", async () => {
    const id = await passedLead()
    expect((await tick(id)).ok).toBe(true)
    // A Staff child discount takes 25% off the School fee only.
    const requested = await requestDiscount(await signedIn(ADMISSIONS), id, "staff_child", "Father teaches at the school.", randomUUID())
    if (!requested.ok) throw new Error(`request failed: ${JSON.stringify(requested.error)}`)
    expect((await decideDiscount(await signedIn(MANAGER), requested.data, { decision: "grant" })).ok).toBe(true)

    await pay(id, payment("initial_deposit", 300_000))
    await pay(id, payment("pre_form_one_fee", 200_000))

    const fee = await feeOf(id)
    expect(fee).toMatchObject({
      bandFee: 2_800_000,
      schoolFee: 2_100_000,
      discount: { kind: "staff_child", percent: 25 },
      totalPaid: 300_000,
      balance: 1_800_000,
      priority: "Deposit",
    })
    expect(fee.preFormOne).toEqual({ ticked: true, offered: true, applies: true, fee: 450_000, paid: 200_000, balance: 250_000 })

    const listed = await listPayments(await signedIn(ADMISSIONS), id)
    expect(listed.ok && listed.data.map((p) => [p.type, p.amount])).toEqual(
      expect.arrayContaining([
        ["initial_deposit", 300_000],
        ["pre_form_one_fee", 200_000],
      ]),
    )
  })

  test("leaves Total paid, the Seat priority and Enrolled as they are", async () => {
    const id = await passedLead()
    expect((await tick(id)).ok).toBe(true)
    await pay(id, payment("initial_deposit", 300_000))
    const before = await feeOf(id)
    expect(before).toMatchObject({ totalPaid: 300_000, priority: "Deposit", priorityReachedOn: today, enrolment: null })

    // Far more than the whole School fee, as a Pre-Form One fee.
    const big = payment("pre_form_one_fee", 3_000_000)
    const preview = await previewPayment(await signedIn(ACCOUNTANT), id, big)
    expect(preview).toEqual({
      ok: true,
      data: expect.objectContaining({
        totalPaid: 300_000,
        totalPaidAfter: 300_000,
        balanceAfter: 2_500_000,
        priority: "Deposit",
        priorityAfter: "Deposit",
        wouldOverfill: false,
        preFormOne: { fee: 450_000, paid: 0, paidAfter: 3_000_000, balanceAfter: -2_550_000 },
      }),
    })
    const recorded = await record(id, big)
    expect(recorded).toEqual({ ok: true, data: { paymentId: expect.any(String), totalPaid: 300_000, priority: "Deposit" } })

    const after = await feeOf(id)
    expect(after).toMatchObject({ totalPaid: 300_000, balance: 2_500_000, priority: "Deposit", priorityReachedOn: today, enrolment: null })
    expect(after.preFormOne).toMatchObject({ paid: 3_000_000, balance: -2_550_000 })
    expect(await getLead(await signedIn(ADMISSIONS), id)).toMatchObject({ ok: true, data: { status: "Interviewed" } })

    // A school-fee payment's preview leaves the Pre-Form One fee alone.
    const schoolFee = await previewPayment(await signedIn(ACCOUNTANT), id, payment("first_instalment", 900_000))
    expect(schoolFee).toEqual({
      ok: true,
      data: expect.objectContaining({
        totalPaidAfter: 1_200_000,
        priorityAfter: "First instalment",
        preFormOne: { fee: 450_000, paid: 3_000_000, paidAfter: 3_000_000, balanceAfter: -2_550_000 },
      }),
    })
  })
})

describe("adjusting a Pre-Form One fee payment", () => {
  function corrected(type: PaymentInput["type"], amount: number): AdjustmentInput {
    return { reason: type === "pre_form_one_fee" ? "Wrong amount" : "Wrong payment type", void: false, type, amount, paidOn: today, note: null }
  }

  async function adjust(paymentId: string, adjustment: AdjustmentInput) {
    return adjustPayment(await signedIn(ACCOUNTANT), paymentId, adjustment, randomUUID())
  }

  test("works like any other payment, and can't move it into or out of the School fee", async () => {
    const id = await passedLead()
    expect((await tick(id)).ok).toBe(true)
    const deposit = await pay(id, payment("initial_deposit", 300_000))
    const programme = await pay(id, payment("pre_form_one_fee", 200_000))

    expect(await adjust(programme, corrected("initial_deposit", 200_000))).toEqual({ ok: false, error: "type_pre_form_one" })
    expect(await adjust(deposit, corrected("pre_form_one_fee", 300_000))).toEqual({ ok: false, error: "type_pre_form_one" })

    const amended = await adjust(programme, corrected("pre_form_one_fee", 450_000))
    expect(amended).toEqual({ ok: true, data: { adjustmentId: expect.any(String), totalPaid: 300_000, priority: "Deposit" } })
    expect(await programmeOf(id)).toMatchObject({ paid: 450_000, balance: 0 })

    // A void takes it out of the programme's paid amount only.
    expect((await adjust(programme, { reason: "Duplicate entry", void: true, note: "Entered twice." })).ok).toBe(true)
    expect(await programmeOf(id)).toMatchObject({ paid: 0, balance: 450_000 })
    expect(await feeOf(id)).toMatchObject({ totalPaid: 300_000, priority: "Deposit" })
  })

  test("still works once the tick no longer applies", async () => {
    const id = await passedLead()
    expect((await tick(id)).ok).toBe(true)
    const programme = await pay(id, payment("pre_form_one_fee", 200_000))
    expect((await updateLeadDetails(await signedIn(ADMISSIONS), id, { className: "FORM 2" })).ok).toBe(true)

    expect((await adjust(programme, corrected("pre_form_one_fee", 250_000))).ok).toBe(true)
    expect(await programmeOf(id)).toMatchObject({ applies: false, paid: 250_000, balance: 200_000 })
  })
})
