import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, getLead, type LeadStatus } from "@/lib/services/leads"
import { adjustPayment, type AdjustmentInput } from "@/lib/services/payment-adjustments"
import { listPayments, listSeatPriorities, recordPayment, type PaymentInput, type SeatPriority } from "@/lib/services/school-fee-payments"

import { anonClient, asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Payment adjustments (#110) through the payments and adjustments modules,
// against local Supabase, signed in as each seeded role. Each test makes
// leads of its own, Passed in a year it claims with a schedule of its own
// (tests/support/fee-years.ts), except the closed-lead test, which adjusts
// the seeded Declined and Archived leads' payments.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const tomorrow = tanzaniaToday(new Date(Date.now() + DAY))
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// Seeded (supabase/seeds/90_fees.sql): a payment on a Declined lead and one
// on an Archived lead, both 2027 Initial deposits.
const SEEDED_DECLINED = { lead: "1ead0000-0000-4000-8000-000000000905", payment: "fee00000-0000-4000-8000-000000000905" }
const SEEDED_ARCHIVED = { lead: "1ead0000-0000-4000-8000-000000000906", payment: "fee00000-0000-4000-8000-000000000906" }

// STD 2 Day: TZS 2,000,000, so First instalment from 800,000 and Deposit
// from 300,000.
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
  // A leading 5 keeps it clear of the seeded 700 000 numbers and of the other
  // test files' 06 and 07 numbers.
  return `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in STD 2 Day lead in its own year, interviewed and Passed today.
async function passedLead(): Promise<string> {
  const year = await yearWithSchedule()
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Adjust Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Adjusted ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
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

async function pay(leadId: string, amount: number, overrides: Partial<PaymentInput> = {}): Promise<string> {
  const recorded = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "initial_deposit", amount, paidOn: today, ...overrides },
    randomUUID(),
  )
  if (!recorded.ok) throw new Error(`payment failed: ${recorded.error}`)
  return recorded.data.paymentId
}

function corrected(values: { type?: PaymentInput["type"]; amount: number; paidOn?: string; reason?: AdjustmentInput["reason"] }): AdjustmentInput {
  return {
    reason: values.reason ?? "Wrong amount",
    void: false,
    type: values.type ?? "initial_deposit",
    amount: values.amount,
    paidOn: values.paidOn ?? today,
    note: null,
  }
}

const VOID: AdjustmentInput = { reason: "Duplicate entry", void: true, note: "Entered twice." }

async function adjust(paymentId: string, adjustment: AdjustmentInput) {
  return adjustPayment(await signedIn(ACCOUNTANT), paymentId, adjustment, randomUUID())
}

async function feeOf(leadId: string): Promise<{ totalPaid: number; priority: SeatPriority | null; reachedOn: string | null }> {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return { totalPaid: fee.data.totalPaid, priority: fee.data.priority, reachedOn: fee.data.priorityReachedOn }
}

async function stateOf(leadId: string): Promise<{ status: LeadStatus; closure: string | null }> {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`)
  return { status: lead.data.status, closure: lead.data.closure }
}

async function paymentsOf(leadId: string) {
  const listed = await listPayments(await signedIn(ADMISSIONS), leadId)
  if (!listed.ok) throw new Error(`no payments: ${listed.error}`)
  return listed.data
}

async function storedAdjustments(paymentId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query("select reason::text, voided, amount from public.payment_adjustments where payment_id = $1 order by sequence", [paymentId]))
        .rows,
  )
}

describe("adjusting a payment", () => {
  test("states the corrected amount, type and date, and the newest adjustment wins", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 300_000)
    expect(await feeOf(id)).toEqual({ totalPaid: 300_000, priority: "Deposit", reachedOn: today })

    const first = await adjust(paymentId, corrected({ amount: 900_000 }))
    expect(first).toEqual({ ok: true, data: { adjustmentId: expect.any(String), totalPaid: 900_000, priority: "First instalment" } })
    expect(await feeOf(id)).toEqual({ totalPaid: 900_000, priority: "First instalment", reachedOn: today })

    // A wrong adjustment is fixed by adjusting the same payment again.
    const second = await adjust(
      paymentId,
      corrected({ reason: "Wrong payment type", type: "first_instalment", amount: 850_000, paidOn: "2026-03-02" }),
    )
    expect(second.ok).toBe(true)
    expect(await feeOf(id)).toEqual({ totalPaid: 850_000, priority: "First instalment", reachedOn: "2026-03-02" })

    const [listed] = await paymentsOf(id)
    expect(listed).toMatchObject({
      id: paymentId,
      type: "initial_deposit",
      amount: 300_000,
      paidOn: today,
      recordedBy: ACCOUNTANT.name,
      effective: { type: "first_instalment", amount: 850_000, paidOn: "2026-03-02" },
    })
    expect(listed.adjustments).toEqual([
      {
        id: first.ok && first.data.adjustmentId,
        reason: "Wrong amount",
        voided: false,
        type: "initial_deposit",
        amount: 900_000,
        paidOn: today,
        note: null,
        recordedAt: expect.any(String),
        recordedBy: ACCOUNTANT.name,
      },
      expect.objectContaining({ reason: "Wrong payment type", type: "first_instalment", amount: 850_000, paidOn: "2026-03-02" }),
    ])
  })

  test("an adjustment that changes nothing, a future date or a bad amount is refused and adds nothing", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 300_000)
    expect(await adjust(paymentId, corrected({ amount: 300_000 }))).toEqual({ ok: false, error: "unchanged" })
    expect(await adjust(paymentId, corrected({ amount: 300_000, paidOn: tomorrow }))).toEqual({ ok: false, error: "date_in_future" })
    expect(await adjust(paymentId, corrected({ amount: 0 }))).toEqual({ ok: false, error: "amount_not_positive" })
    expect(await adjust(paymentId, corrected({ amount: 300_000.5 }))).toEqual({ ok: false, error: "amount_not_whole" })
    expect(await adjust(paymentId, { ...corrected({ amount: 400_000 }), note: "x".repeat(1001) })).toEqual({
      ok: false,
      error: "note_too_long",
    })
    expect(await adjust(randomUUID(), corrected({ amount: 400_000 }))).toEqual({ ok: false, error: "not_found" })
    expect(await storedAdjustments(paymentId)).toEqual([])
  })

  test("a Save retried with the same request id adjusts the payment once", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 300_000)
    const accountant = await signedIn(ACCOUNTANT)
    const requestId = randomUUID()

    const first = await adjustPayment(accountant, paymentId, corrected({ amount: 350_000 }), requestId)
    const retried = await adjustPayment(accountant, paymentId, corrected({ amount: 350_000 }), requestId)
    expect(first.ok).toBe(true)
    expect(retried).toEqual(first)
    // The same id with a different adjustment is refused.
    expect(await adjustPayment(accountant, paymentId, corrected({ amount: 360_000 }), requestId)).toEqual({
      ok: false,
      error: "unavailable",
    })
    expect(await storedAdjustments(paymentId)).toEqual([{ reason: "Wrong amount", voided: false, amount: 350_000 }])
  })
})

describe("voiding and restoring", () => {
  test("a void needs Duplicate entry, Duplicate entry always voids, and a void removes the payment", async () => {
    const id = await passedLead()
    await pay(id, 300_000)
    const duplicate = await pay(id, 300_000)
    expect(await feeOf(id)).toMatchObject({ totalPaid: 600_000, priority: "Deposit" })

    expect(await adjust(duplicate, { reason: "Wrong amount", void: true, note: null })).toEqual({
      ok: false,
      error: "void_needs_duplicate",
    })
    expect(await adjust(duplicate, corrected({ reason: "Duplicate entry", amount: 1 }))).toEqual({
      ok: false,
      error: "duplicate_needs_void",
    })
    expect(await storedAdjustments(duplicate)).toEqual([])

    expect(await adjust(duplicate, VOID)).toEqual({ ok: true, data: { adjustmentId: expect.any(String), totalPaid: 300_000, priority: "Deposit" } })
    expect(await feeOf(id)).toMatchObject({ totalPaid: 300_000, priority: "Deposit" })
    const listed = (await paymentsOf(id)).find((p) => p.id === duplicate)
    expect(listed).toMatchObject({ amount: 300_000, effective: null })
    expect(listed?.adjustments).toEqual([expect.objectContaining({ reason: "Duplicate entry", voided: true, type: null, amount: null, note: "Entered twice." })])
  })

  test("a voided payment comes back only with Data-entry correction", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 300_000)
    expect((await adjust(paymentId, VOID)).ok).toBe(true)
    expect(await feeOf(id)).toEqual({ totalPaid: 0, priority: null, reachedOn: null })

    expect(await adjust(paymentId, corrected({ amount: 300_000 }))).toEqual({ ok: false, error: "restore_needs_correction" })
    expect(await adjust(paymentId, VOID)).toEqual({ ok: false, error: "restore_needs_correction" })

    const restored = await adjust(paymentId, corrected({ reason: "Data-entry correction", amount: 300_000 }))
    expect(restored).toEqual({ ok: true, data: { adjustmentId: expect.any(String), totalPaid: 300_000, priority: "Deposit" } })
    expect((await paymentsOf(id))[0].effective).toEqual({ type: "initial_deposit", amount: 300_000, paidOn: today })
  })

  test("a void takes an Enrolled lead back to its earlier status, and a restore enrols it again", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 2_000_000, { type: "full_payment" })
    expect((await stateOf(id)).status).toBe("Enrolled")

    expect(await adjust(paymentId, VOID)).toEqual({ ok: true, data: { adjustmentId: expect.any(String), totalPaid: 0, priority: null } })
    expect(await stateOf(id)).toEqual({ status: "Interviewed", closure: null })
    const fee = await getLeadFee(await signedIn(ACCOUNTANT), id)
    expect(fee.ok && fee.data.kind === "fee" && fee.data.enrolment).toBeNull()

    expect((await adjust(paymentId, corrected({ reason: "Data-entry correction", type: "full_payment", amount: 2_000_000 }))).ok).toBe(true)
    expect((await stateOf(id)).status).toBe("Enrolled")
  })

  test("Seat priorities and seat counts leave a voided payment out", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 300_000)
    const accountant = await signedIn(ACCOUNTANT)
    expect(await listSeatPriorities(accountant, [id])).toEqual({ ok: true, data: { [id]: { priority: "Deposit", reachedOn: today } } })

    await adjust(paymentId, VOID)
    expect(await listSeatPriorities(accountant, [id])).toEqual({ ok: true, data: {} })
    const { data } = await accountant.rpc("seat_check", { lead_id: id })
    expect(data).toMatchObject({ priority: null, holds_seat: false })
  })
})

describe("the type rules", () => {
  // Fee waived and the Pre-Form One fee come with their own tickets (#112,
  // #114), so these payments are written as the database owner.
  async function paymentOfType(leadId: string, type: "fee_waived" | "pre_form_one_fee"): Promise<string> {
    return asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        `insert into public.school_fee_payments (lead_id, payment_type, amount, paid_on, recorded_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [leadId, type, type === "fee_waived" ? null : 450_000, today, ACCOUNTANT.id],
      )
      return rows[0].id
    })
  }

  test("no move between a school-fee type and the Pre-Form One fee, nothing made Fee waived, no change to a Fee waived payment's type", async () => {
    const id = await passedLead()
    const schoolFee = await pay(id, 300_000)
    const preFormOne = await paymentOfType(id, "pre_form_one_fee")
    const waived = await paymentOfType(id, "fee_waived")
    const wrongType = (type: PaymentInput["type"] | "fee_waived" | "pre_form_one_fee", amount: number | null) =>
      ({ reason: "Wrong payment type", void: false, type, amount, paidOn: today, note: null }) as AdjustmentInput

    expect(await adjust(schoolFee, wrongType("pre_form_one_fee", 300_000))).toEqual({ ok: false, error: "type_pre_form_one" })
    expect(await adjust(preFormOne, wrongType("initial_deposit", 450_000))).toEqual({ ok: false, error: "type_pre_form_one" })
    expect(await adjust(schoolFee, wrongType("fee_waived", null))).toEqual({ ok: false, error: "type_to_fee_waived" })
    expect(await adjust(preFormOne, wrongType("fee_waived", null))).toEqual({ ok: false, error: "type_to_fee_waived" })
    expect(await adjust(waived, wrongType("full_payment", 2_000_000))).toEqual({ ok: false, error: "type_from_fee_waived" })

    // Within its own fee a type may change, a Pre-Form One fee's amount may
    // change, and a Fee waived payment's date may change or it may be voided.
    expect((await adjust(schoolFee, wrongType("first_instalment", 300_000))).ok).toBe(true)
    expect((await adjust(preFormOne, corrected({ type: "pre_form_one_fee" as never, amount: 400_000 }))).ok).toBe(true)
    expect(
      (await adjust(waived, { reason: "Wrong payment date", void: false, type: "fee_waived", amount: null, paidOn: yesterday, note: null })).ok,
    ).toBe(true)
    expect((await adjust(waived, VOID)).ok).toBe(true)

    // The database holds the rules however the row arrives.
    const direct = (paymentId: string, type: string, amount: number | null) =>
      asSystem((sql) =>
        sql.query(
          `insert into public.payment_adjustments (payment_id, lead_id, reason, payment_type, amount, paid_on, recorded_by)
           values ($1, $2, 'Wrong payment type', $3, $4, $5, $6)`,
          [paymentId, id, type, amount, today, ACCOUNTANT.id],
        ),
      )
    await expect(direct(schoolFee, "pre_form_one_fee", 300_000)).rejects.toThrow(/type_pre_form_one/)
    await expect(direct(schoolFee, "fee_waived", null)).rejects.toThrow(/type_to_fee_waived/)
    await expect(direct(waived, "full_payment", 1)).rejects.toThrow(/restore_needs_correction|type_from_fee_waived/)
  })
})

describe("closed leads", () => {
  // Re-runs on the same database add adjustments to the seeded payments, so
  // each run moves the amount to whichever value it doesn't hold now. Both
  // stay Deposit on a TZS 2,000,000 fee.
  async function nextAmount(leadId: string, paymentId: string): Promise<number> {
    const current = (await paymentsOf(leadId)).find((p) => p.id === paymentId)?.effective?.amount
    return current === 450_000 ? 350_000 : 450_000
  }

  test("an adjustment is accepted on the seeded Declined and Archived leads, which stay closed", async () => {
    const before = { declined: await stateOf(SEEDED_DECLINED.lead), archived: await stateOf(SEEDED_ARCHIVED.lead) }
    expect(before).toEqual({ declined: { status: "Declined", closure: null }, archived: { status: "Interviewed", closure: "Archived" } })

    for (const seeded of [SEEDED_DECLINED, SEEDED_ARCHIVED]) {
      const amount = await nextAmount(seeded.lead, seeded.payment)
      const adjusted = await adjust(seeded.payment, {
        ...corrected({ amount, paidOn: seeded === SEEDED_DECLINED ? "2026-09-23" : "2026-09-24" }),
        note: "Receipt checked.",
      })
      expect(adjusted, seeded.lead).toEqual({ ok: true, data: { adjustmentId: expect.any(String), totalPaid: amount, priority: "Deposit" } })
      expect((await feeOf(seeded.lead)).totalPaid, seeded.lead).toBe(amount)
    }

    expect({ declined: await stateOf(SEEDED_DECLINED.lead), archived: await stateOf(SEEDED_ARCHIVED.lead) }).toEqual(before)
  })
})

describe("who may adjust", () => {
  test("only payments.record may adjust; staff and the database owner can't change or delete an adjustment", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 300_000)

    for (const person of [ADMISSIONS, MANAGER]) {
      const staff = await signedIn(person)
      expect(await adjustPayment(staff, paymentId, corrected({ amount: 400_000 }), randomUUID()), person.roleName).toEqual({
        ok: false,
        error: "forbidden",
      })
    }
    expect(await adjustPayment(anonClient(), paymentId, corrected({ amount: 400_000 }), randomUUID())).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await storedAdjustments(paymentId)).toEqual([])

    const made = await adjust(paymentId, corrected({ amount: 400_000 }))
    if (!made.ok) throw new Error(made.error)
    const adjustmentId = made.data.adjustmentId

    for (const person of [ACCOUNTANT, MANAGER, ADMISSIONS]) {
      const staff = await signedIn(person)
      // Every seeded role may view payments, so each reads the adjustment.
      const { data } = await staff.from("payment_adjustments").select("amount").eq("id", adjustmentId)
      expect(data, person.roleName).toEqual([{ amount: 400_000 }])
      await staff.from("payment_adjustments").update({ amount: 1 }).eq("id", adjustmentId)
      await staff.from("payment_adjustments").delete().eq("id", adjustmentId)
      const inserted = await staff
        .from("payment_adjustments")
        .insert({ payment_id: paymentId, lead_id: id, reason: "Wrong amount", payment_type: "initial_deposit", amount: 5, paid_on: today, recorded_by: ACCOUNTANT.id })
      expect(inserted.error, person.roleName).not.toBeNull()
    }
    const { data: hidden } = await anonClient().from("payment_adjustments").select("id").eq("id", adjustmentId)
    expect(hidden ?? []).toEqual([])

    await expect(
      asSystem((sql) => sql.query("update public.payment_adjustments set amount = 1 where id = $1", [adjustmentId])),
    ).rejects.toThrow(/payment_locked/)
    await expect(
      asSystem((sql) => sql.query("delete from public.payment_adjustments where id = $1", [adjustmentId])),
    ).rejects.toThrow(/delete_refused/)
    expect(await storedAdjustments(paymentId)).toEqual([{ reason: "Wrong amount", voided: false, amount: 400_000 }])
  })
})

describe("the history", () => {
  test("shows each adjustment, and the Seat priority and Enrolled changes it caused", async () => {
    const id = await passedLead()
    const paymentId = await pay(id, 2_000_000, { type: "full_payment" })
    await adjust(paymentId, VOID)

    const history = await getLeadHistory(await signedIn(ADMISSIONS), id)
    if (!history.ok) throw new Error(history.error)
    // Newest first, all in the adjustment's one transaction.
    const [priority, status, profile, adjustment] = history.data.entries
    expect(status).toMatchObject({ record: "lead", actor: ACCOUNTANT.name, changes: [{ field: "status", from: "Enrolled", to: "Interviewed" }] })
    expect(profile).toMatchObject({
      record: "lead_fee_profiles",
      changes: expect.arrayContaining([{ field: "recompute_cause", from: "payment", to: "payment_adjustment" }]),
    })
    expect(priority).toMatchObject({
      record: null,
      action: "seat_priority_changed",
      actor: ACCOUNTANT.name,
      changes: expect.arrayContaining([
        { field: "priority", from: "Full", to: null },
        { field: "cause", from: null, to: "payment_adjustment" },
      ]),
    })
    expect(adjustment).toMatchObject({ record: "payment_adjustments", action: "insert", actor: ACCOUNTANT.name })
    expect(Object.fromEntries(adjustment.changes.map((c) => [c.field, c.to]))).toMatchObject({
      payment_id: paymentId,
      reason: "Duplicate entry",
      voided: true,
      note: "Entered twice.",
    })
  })
})
