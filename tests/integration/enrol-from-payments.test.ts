import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead, markLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, getLead, updateLeadDetails, type LeadClass, type LeadStatus } from "@/lib/services/leads"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Enrolled from the payments (#108), through the fees, payments and lead
// modules against local Supabase, signed in as each seeded role. Each test
// makes leads of its own, Passed in a year it claims with a schedule of its
// own (tests/support/fee-years.ts).

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// STD 2 Day: TZS 2,000,000, so First instalment from 800,000 and Deposit
// from 300,000. FORM 1 Day costs more: TZS 2,800,000.
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

function withStd2Day(day: number): FeeAmounts {
  return { ...AMOUNTS, bands: { ...AMOUNTS.bands, primary_lower: { ...AMOUNTS.bands.primary_lower, day } } }
}

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  await saveSchedule(claim.year, AMOUNTS)
  return claim.year
}

async function saveSchedule(year: number, amounts: FeeAmounts) {
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), year, amounts)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
}

// The year's Academic-year start, whatever an earlier run left there. Claimed
// years are reused and saving amounts keeps the start, so this sets it
// directly rather than through the Manager's stale-checked save.
async function setStart(year: number, start: string) {
  await asSystem((sql) => sql.query("update public.fee_schedules set academic_year_start = $2 where enrollment_year = $1", [year, start]))
}

function phone() {
  // A leading 5 keeps it clear of the seeded 700 000 numbers and of the other
  // test files' 06 and 07 numbers.
  return `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in lead in `year`, interviewed and Passed today.
async function passedLead(year: number, className: LeadClass = "STD 2"): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Enrol Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Enrolee ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
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

async function pay(leadId: string, amount: number, overrides: Partial<PaymentInput> = {}) {
  const recorded = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "initial_deposit", amount, paidOn: today, ...overrides },
    randomUUID(),
  )
  if (!recorded.ok) throw new Error(`payment failed: ${recorded.error}`)
  return recorded.data.paymentId
}

async function stateOf(leadId: string): Promise<{ status: LeadStatus; closure: string | null }> {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`)
  return { status: lead.data.status, closure: lead.data.closure }
}

async function enrolmentOf(supabase: SupabaseClient, leadId: string) {
  const fee = await getLeadFee(supabase, leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data.enrolment
}

async function profileOf(leadId: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query(
      `select status_before_enrolled, enrolled_trigger, enrolled_trigger_payment_id, enrolled_on::text, recompute_cause
       from public.lead_fee_profiles where lead_id = $1`,
      [leadId],
    )
    return rows[0] ?? null
  })
}

describe("Enrolled from the payments", () => {
  test("a payment that reaches Full enrols the lead, and the lead fee says which payment and when", async () => {
    const id = await passedLead(await yearWithSchedule())
    expect(await stateOf(id)).toEqual({ status: "Interviewed", closure: null })

    await pay(id, 800_000, { type: "first_instalment", paidOn: "2026-03-01" })
    expect((await stateOf(id)).status).toBe("Interviewed")

    const second = await pay(id, 1_200_000, { type: "second_instalment", paidOn: yesterday })
    expect(await stateOf(id)).toEqual({ status: "Enrolled", closure: null })
    expect(await enrolmentOf(await signedIn(ADMISSIONS), id)).toEqual({
      on: yesterday,
      by: { kind: "payment", type: "second_instalment", amount: 1_200_000 },
    })
    expect(await profileOf(id)).toEqual({
      status_before_enrolled: "Interviewed",
      enrolled_trigger: "payment",
      enrolled_trigger_payment_id: second,
      enrolled_on: yesterday,
      recompute_cause: "payment",
    })
  })

  test("never enrols on Deposit, or on First instalment before the Academic-year start", async () => {
    const year = await yearWithSchedule()
    await setStart(year, `${year}-01-10`)

    const deposit = await passedLead(year)
    await pay(deposit, 300_000)
    const first = await passedLead(year)
    await pay(first, 1_999_999, { type: "first_instalment" })

    for (const id of [deposit, first]) {
      expect((await stateOf(id)).status).toBe("Interviewed")
      expect(await enrolmentOf(await signedIn(ACCOUNTANT), id)).toBeNull()
      expect(await profileOf(id)).toBeNull()
    }
  })

  test("a First instalment lead enrols on the Academic-year start, dated the start", async () => {
    const year = await yearWithSchedule()
    const start = `${year}-01-10`
    await setStart(year, start)
    const id = await passedLead(year)
    await pay(id, 800_000, { type: "first_instalment" })

    // The day before the start, then the day itself, as #109's job will.
    await asSystem((sql) => sql.query("select public.recompute_lead_fee($1, 'academic_year_start', $2)", [id, `${year}-01-09`]))
    expect((await stateOf(id)).status).toBe("Interviewed")
    await asSystem((sql) => sql.query("select public.recompute_lead_fee($1, 'academic_year_start', $2)", [id, start]))
    expect((await stateOf(id)).status).toBe("Enrolled")
    expect(await enrolmentOf(await signedIn(ACCOUNTANT), id)).toEqual({ on: start, by: { kind: "academic-year-start" } })
  })

  test("a fee increase in the schedule takes the lead back below the line to its earlier status", async () => {
    const year = await yearWithSchedule()
    const id = await passedLead(year)
    await pay(id, 2_000_000, { type: "full_payment" })
    expect((await stateOf(id)).status).toBe("Enrolled")

    await saveSchedule(year, withStd2Day(2_100_000))
    expect(await stateOf(id)).toEqual({ status: "Interviewed", closure: null })
    expect(await enrolmentOf(await signedIn(ACCOUNTANT), id)).toBeNull()
    expect(await profileOf(id)).toMatchObject({
      status_before_enrolled: null,
      enrolled_trigger: null,
      enrolled_on: null,
      recompute_cause: "fee_schedule",
    })

    // Corrected back, the same payment enrols it again.
    await saveSchedule(year, AMOUNTS)
    expect((await stateOf(id)).status).toBe("Enrolled")
  })

  test("a class correction takes the lead back below the line, and back again", async () => {
    const id = await passedLead(await yearWithSchedule())
    await pay(id, 2_000_000, { type: "full_payment" })
    expect((await stateOf(id)).status).toBe("Enrolled")

    const admissions = await signedIn(ADMISSIONS)
    const moved = await updateLeadDetails(admissions, id, { className: "FORM 1" })
    expect(moved).toEqual({ ok: true, data: null })
    expect((await stateOf(id)).status).toBe("Interviewed")
    expect(await profileOf(id)).toMatchObject({ enrolled_trigger: null, recompute_cause: "lead_details" })

    expect(await updateLeadDetails(admissions, id, { className: "STD 2" })).toEqual({ ok: true, data: null })
    expect((await stateOf(id)).status).toBe("Enrolled")
  })

  test("a Declined lead is left unchanged and keeps its payments", async () => {
    const year = await yearWithSchedule()
    const id = await passedLead(year)
    await pay(id, 1_900_000, { type: "first_instalment" })
    const declined = await declineLead(await signedIn(MANAGER), id, { reason: "Family changed plans" })
    expect(declined).toEqual({ ok: true, data: null })

    // A fee cut to what was paid would make it Full.
    await saveSchedule(year, withStd2Day(1_900_000))
    expect((await stateOf(id)).status).toBe("Declined")
    expect(await profileOf(id)).toBeNull()
    const fee = await getLeadFee(await signedIn(ACCOUNTANT), id)
    expect(fee.ok && fee.data.kind === "fee" && fee.data.totalPaid).toBe(1_900_000)
  })

  test("an Inactive lead is enrolled through the override, and keeps its mark", async () => {
    const year = await yearWithSchedule()
    const id = await passedLead(year)
    await pay(id, 1_900_000, { type: "first_instalment" })
    const marked = await markLead(await signedIn(MANAGER), id, { mark: "inactive", reason: "Family requested closure" })
    expect(marked).toEqual({ ok: true, data: null })

    await saveSchedule(year, withStd2Day(1_900_000))
    expect(await stateOf(id)).toEqual({ status: "Enrolled", closure: "Inactive" })

    // And back to its earlier status, still Inactive.
    await saveSchedule(year, AMOUNTS)
    expect(await stateOf(id)).toEqual({ status: "Interviewed", closure: "Inactive" })
  })

  test("the history shows the Enrolled change and its cause, under whoever caused it", async () => {
    const year = await yearWithSchedule()
    const id = await passedLead(year)
    await pay(id, 2_000_000, { type: "full_payment" })
    await saveSchedule(year, withStd2Day(2_100_000))

    const history = await getLeadHistory(await signedIn(ADMISSIONS), id)
    if (!history.ok) throw new Error(history.error)
    const enrolment = history.data.entries.filter(
      (entry) =>
        entry.record === "lead_fee_profiles" ||
        (entry.record === "lead" && entry.changes.some((c) => c.field === "status" && (c.to === "Enrolled" || c.from === "Enrolled"))),
    )
    // Newest first: taken out by the schedule change, enrolled by the payment.
    expect(
      enrolment.map((entry) => ({
        record: entry.record,
        actor: entry.actor,
        changes: Object.fromEntries(entry.changes.map((c) => [c.field, c.to])),
      })),
    ).toEqual([
      { record: "lead", actor: ACCOUNTANT.name, changes: { status: "Interviewed" } },
      {
        record: "lead_fee_profiles",
        actor: ACCOUNTANT.name,
        changes: {
          status_before_enrolled: null,
          enrolled_trigger: null,
          enrolled_trigger_payment_id: null,
          enrolled_on: null,
          recompute_cause: "fee_schedule",
        },
      },
      { record: "lead", actor: ACCOUNTANT.name, changes: { status: "Enrolled" } },
      {
        record: "lead_fee_profiles",
        actor: ACCOUNTANT.name,
        changes: expect.objectContaining({
          lead_id: id,
          status_before_enrolled: "Interviewed",
          enrolled_trigger: "payment",
          enrolled_on: today,
          recompute_cause: "payment",
        }),
      },
    ])
  })
})

describe("Nobody sets Enrolled by hand", () => {
  test("a lead correction ignores a status, and a write function in a staff session can't set Enrolled", async () => {
    const id = await passedLead(await yearWithSchedule())
    const admissions = await signedIn(ADMISSIONS)
    await updateLeadDetails(admissions, id, { status: "Enrolled" } as never)
    expect((await stateOf(id)).status).toBe("Interviewed")

    // Staff may not write to leads at all.
    const direct = await admissions.from("leads").update({ status: "Enrolled" }).eq("id", id).select("id")
    expect(direct.data ?? []).toEqual([])

    // A write function runs as the database owner for a signed-in session;
    // the guard refuses it all the same.
    const refused = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(`select set_config('request.jwt.claims', '{"role":"authenticated"}', true)`)
      return sql.query("update public.leads set status = 'Enrolled' where id = $1", [id]).then(
        () => null,
        (error: Error) => error.message,
      )
    })
    expect(refused).toBe("enrolled_from_payments")
  })

  test("no API role may call the recompute itself", async () => {
    const id = await passedLead(await yearWithSchedule())
    const { error } = await (await signedIn(ACCOUNTANT)).rpc("recompute_lead_fee", { lead_id: id, cause: "payment" })
    expect(error).not.toBeNull()
  })
})
