import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"
import {
  listPayments,
  listSeatPriorities,
  previewPayment,
  recordPayment,
  type PaymentInput,
  type SeatPriority,
} from "@/lib/services/school-fee-payments"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { claimFeeYear, noScheduleYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// School-fee payments and the Seat priority through the payments module,
// against local Supabase, signed in as each seeded role. Each test makes
// leads of its own, Passed in a year it claims with a schedule of its own
// (tests/support/fee-years.ts); the seeded leads are only read.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const tomorrow = tanzaniaToday(new Date(Date.now() + DAY))
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// Seeded leads: slice 2's Archived one, and #107's priorities.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const SEEDED = {
  none: "1ead0000-0000-4000-8000-000000000901",
  deposit: "1ead0000-0000-4000-8000-000000000902",
  first: "1ead0000-0000-4000-8000-000000000903",
  full: "1ead0000-0000-4000-8000-000000000904",
}

// STD 2 Day: TZS 2,000,000, so First instalment from 800,000 and Deposit
// from 300,000. STD 5 Day's 1,000,003 has a 40% share of 400,001.2.
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

type Interview = "passed" | "failed" | "registered" | "none"

// A walk-in lead in `year`, with its interview as asked: Passed by default.
async function lead(
  year: number,
  { interview = "passed", className = "STD 2", dayOrBoarding = "Day" }: { interview?: Interview; className?: LeadClass; dayOrBoarding?: DayOrBoarding } = {},
): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Payment Parent", relationship: "Father", phone: phone() } },
    student: { fullName: `Payer ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  if (interview !== "none") {
    const registered = await registerForInterview(admissions, id)
    if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
    if (interview !== "registered") {
      const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
        interviewDate: today,
        result: interview === "passed" ? "Passed" : "Failed",
        score: interview === "passed" ? 75 : 30,
      })
      if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
    }
  }
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return id
}

function payment(amount: number, overrides: Partial<PaymentInput> = {}): PaymentInput {
  return { type: "initial_deposit", amount, paidOn: today, ...overrides }
}

async function pay(supabase: SupabaseClient, leadId: string, input: PaymentInput) {
  const recorded = await recordPayment(supabase, leadId, input)
  if (!recorded.ok) throw new Error(`payment failed: ${recorded.error}`)
  return recorded.data
}

async function priorityOf(leadId: string): Promise<{ priority: SeatPriority | null; reachedOn: string | null; totalPaid: number; balance: number }> {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return { priority: fee.data.priority, reachedOn: fee.data.priorityReachedOn, totalPaid: fee.data.totalPaid, balance: fee.data.balance }
}

async function storedPayments(leadId: string) {
  return inRolledBackTransaction(
    async (sql) => (await sql.query("select id, amount from public.school_fee_payments where lead_id = $1", [leadId])).rows,
  )
}

describe("Seat priority", () => {
  test.each([
    { paid: 299_999, priority: null },
    { paid: 300_000, priority: "Deposit" },
    { paid: 300_001, priority: "Deposit" },
    { paid: 799_999, priority: "Deposit" },
    { paid: 800_000, priority: "First instalment" },
    { paid: 800_001, priority: "First instalment" },
    { paid: 1_999_999, priority: "First instalment" },
    { paid: 2_000_000, priority: "Full" },
    { paid: 2_000_001, priority: "Full" },
  ])("a TZS 2,000,000 fee with $paid paid has priority $priority", async ({ paid, priority }) => {
    const id = await lead(await yearWithSchedule())
    const recorded = await pay(await signedIn(ACCOUNTANT), id, payment(paid, { paidOn: yesterday }))
    expect(recorded).toEqual({ paymentId: expect.any(String), totalPaid: paid, priority })
    expect(await priorityOf(id)).toEqual({
      priority,
      reachedOn: priority === null ? null : yesterday,
      totalPaid: paid,
      balance: 2_000_000 - paid,
    })
  })

  test("First instalment is compared exactly, not against the rounded instalment", async () => {
    // 40% of 1,000,003 is 400,001.2: the rounded first instalment is 400,001,
    // which is not yet 40%.
    const year = await yearWithSchedule()
    const accountant = await signedIn(ACCOUNTANT)
    const below = await lead(year, { className: "STD 5" })
    await pay(accountant, below, payment(400_001))
    expect((await priorityOf(below)).priority).toBe("Deposit")

    const at = await lead(year, { className: "STD 5" })
    await pay(accountant, at, payment(400_002))
    expect((await priorityOf(at)).priority).toBe("First instalment")
  })

  test("follows the amounts, not the types: a deposit that reaches 40% is First instalment", async () => {
    const id = await lead(await yearWithSchedule())
    await pay(await signedIn(ACCOUNTANT), id, payment(800_000, { type: "initial_deposit" }))
    expect((await priorityOf(id)).priority).toBe("First instalment")
  })

  test("adds up every payment, and the date reached is the payment date whose running total crosses the line", async () => {
    const id = await lead(await yearWithSchedule())
    const accountant = await signedIn(ACCOUNTANT)
    // Recorded out of date order: the running total follows the payment date.
    await pay(accountant, id, payment(200_000, { paidOn: "2026-03-05" }))
    await pay(accountant, id, payment(200_000, { paidOn: "2026-03-01" }))
    expect(await priorityOf(id)).toEqual({ priority: "Deposit", reachedOn: "2026-03-05", totalPaid: 400_000, balance: 1_600_000 })

    await pay(accountant, id, payment(500_000, { type: "first_instalment", paidOn: "2026-03-10" }))
    expect(await priorityOf(id)).toEqual({
      priority: "First instalment",
      reachedOn: "2026-03-10",
      totalPaid: 900_000,
      balance: 1_100_000,
    })

    // An earlier-dated payment counts on its own date: Full is crossed only by
    // the 2026-03-10 payment.
    await pay(accountant, id, payment(1_100_000, { type: "second_instalment", paidOn: "2026-03-02" }))
    expect(await priorityOf(id)).toEqual({ priority: "Full", reachedOn: "2026-03-10", totalPaid: 2_000_000, balance: 0 })

    const listed = await listSeatPriorities(await signedIn(ADMISSIONS), [id, SEEDED.none])
    expect(listed).toEqual({ ok: true, data: { [id]: { priority: "Full", reachedOn: "2026-03-10" } } })
  })

  test("the seeded leads hold each priority", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await listSeatPriorities(staff, Object.values(SEEDED))).toEqual({
      ok: true,
      data: {
        [SEEDED.deposit]: { priority: "Deposit", reachedOn: "2026-09-25" },
        [SEEDED.first]: { priority: "First instalment", reachedOn: "2026-09-24" },
        [SEEDED.full]: { priority: "Full", reachedOn: "2026-09-26" },
      },
    })
  })
})

describe("the preview", () => {
  test("shows the new Total paid, balance and priority, and records nothing", async () => {
    const id = await lead(await yearWithSchedule())
    const accountant = await signedIn(ACCOUNTANT)
    await pay(accountant, id, payment(300_000))

    expect(await previewPayment(accountant, id, payment(500_000, { type: "first_instalment" }))).toEqual({
      ok: true,
      data: {
        schoolFee: 2_000_000,
        totalPaid: 300_000,
        totalPaidAfter: 800_000,
        balanceAfter: 1_200_000,
        priority: "Deposit",
        priorityAfter: "First instalment",
      },
    })
    expect(await storedPayments(id)).toHaveLength(1)
  })
})

describe("recording", () => {
  test("keeps the payment with who recorded it and when, and lists payments newest first", async () => {
    const id = await lead(await yearWithSchedule())
    const accountant = await signedIn(ACCOUNTANT)
    await pay(accountant, id, payment(300_000, { paidOn: "2026-02-01" }))
    await pay(accountant, id, payment(400_000, { type: "first_instalment", paidOn: today }))

    const listed = await listPayments(await signedIn(ADMISSIONS), id)
    expect(listed).toEqual({
      ok: true,
      data: [
        { id: expect.any(String), type: "first_instalment", amount: 400_000, paidOn: today, recordedAt: expect.any(String), recordedBy: ACCOUNTANT.name },
        { id: expect.any(String), type: "initial_deposit", amount: 300_000, paidOn: "2026-02-01", recordedAt: expect.any(String), recordedBy: ACCOUNTANT.name },
      ],
    })
  })

  test("every precondition is refused, by the preview and the recording alike", async () => {
    const year = await yearWithSchedule()
    const accountant = await signedIn(ACCOUNTANT)
    const passed = await lead(year)
    const declined = await lead(year)
    const declinedResult = await declineLead(await signedIn(ADMISSIONS), declined, { reason: "Family changed plans" })
    if (!declinedResult.ok) throw new Error(declinedResult.error)

    const cases: [string, string, PaymentInput, string][] = [
      ["Declined", declined, payment(300_000), "lead_closed"],
      ["Archived", ARCHIVED, payment(300_000), "lead_closed"],
      ["Failed", await lead(year, { interview: "failed" }), payment(300_000), "not_passed"],
      ["no result yet", await lead(year, { interview: "registered" }), payment(300_000), "not_passed"],
      ["no interview", await lead(year, { interview: "none" }), payment(300_000), "not_passed"],
      ["no schedule", await lead(await noScheduleYear()), payment(300_000), "no_schedule"],
      ["zero", passed, payment(0), "amount_not_positive"],
      ["negative", passed, payment(-500), "amount_not_positive"],
      ["a fraction", passed, payment(1000.5), "amount_not_whole"],
      ["too large", passed, payment(3_000_000_000), "amount_too_large"],
      ["tomorrow", passed, payment(300_000, { paidOn: tomorrow }), "date_in_future"],
      ["Fee waived", passed, payment(300_000, { type: "fee_waived" as PaymentInput["type"] }), "invalid_type"],
      ["Pre-Form One", passed, payment(300_000, { type: "pre_form_one_fee" as PaymentInput["type"] }), "invalid_type"],
      ["missing lead", randomUUID(), payment(300_000), "not_found"],
      ["malformed lead", "not-a-lead", payment(300_000), "not_found"],
    ]
    for (const [name, id, input, error] of cases) {
      expect(await previewPayment(accountant, id, input), `preview: ${name}`).toEqual({ ok: false, error })
      expect(await recordPayment(accountant, id, input), name).toEqual({ ok: false, error })
    }
    expect(await storedPayments(passed)).toEqual([])
    expect(await storedPayments(declined)).toEqual([])
  })

  test("the database refuses a future payment date and a missing amount however the row arrives", async () => {
    const id = await lead(await yearWithSchedule())
    const insert = (paidOn: string, amount: number | null) =>
      asSystem((sql) =>
        sql.query(
          `insert into public.school_fee_payments (lead_id, payment_type, amount, paid_on, recorded_by)
           values ($1, 'initial_deposit', $2, $3, $4)`,
          [id, amount, paidOn, ACCOUNTANT.id],
        ),
      )
    await expect(insert(tomorrow, 300_000)).rejects.toThrow(/date_in_future/)
    await expect(insert(today, null)).rejects.toThrow(/check constraint/)
    await expect(insert(today, 0)).rejects.toThrow(/check constraint/)
  })

  test("a recorded payment can't be changed or deleted, by staff or by the database owner", async () => {
    const id = await lead(await yearWithSchedule())
    const { paymentId } = await pay(await signedIn(ACCOUNTANT), id, payment(300_000))

    for (const person of [ACCOUNTANT, MANAGER]) {
      const staff = await signedIn(person)
      await staff.from("school_fee_payments").update({ amount: 1 }).eq("id", paymentId)
      await staff.from("school_fee_payments").delete().eq("id", paymentId)
      expect((await staff.from("school_fee_payments").insert({ lead_id: id, payment_type: "initial_deposit", amount: 5, paid_on: today, recorded_by: ACCOUNTANT.id })).error).not.toBeNull()
    }
    await expect(
      asSystem((sql) => sql.query("update public.school_fee_payments set amount = 1 where id = $1", [paymentId])),
    ).rejects.toThrow(/payment_locked/)
    await expect(
      asSystem((sql) => sql.query("delete from public.school_fee_payments where id = $1", [paymentId])),
    ).rejects.toThrow(/delete_refused/)
    expect(await storedPayments(id)).toEqual([{ id: paymentId, amount: 300_000 }])
  })
})

describe("who may do what", () => {
  test("only payments.record may record or preview; every seeded role may read", async () => {
    const id = await lead(await yearWithSchedule())
    for (const person of [ADMISSIONS, MANAGER]) {
      const staff = await signedIn(person)
      expect(await recordPayment(staff, id, payment(300_000)), person.roleName).toEqual({ ok: false, error: "forbidden" })
      expect(await previewPayment(staff, id, payment(300_000)), person.roleName).toEqual({ ok: false, error: "forbidden" })
    }
    await pay(await signedIn(ACCOUNTANT), id, payment(300_000))
    for (const person of [ACCOUNTANT, MANAGER, ADMISSIONS]) {
      const staff = await signedIn(person)
      const listed = await listPayments(staff, id)
      expect(listed.ok && listed.data.map((p) => p.amount), person.roleName).toEqual([300_000])
      const { data } = await staff.from("school_fee_payments").select("amount").eq("lead_id", id)
      expect(data, person.roleName).toEqual([{ amount: 300_000 }])
    }
  })

  test("staff without payments.view, visitors and the secret key see no payments or priority", async () => {
    const id = await lead(await yearWithSchedule())
    await pay(await signedIn(ACCOUNTANT), id, payment(300_000))
    const viewer = await signedIn(await createThrowawayStaff(["leads.view"]))

    for (const [name, client] of [["leads.view only", viewer], ["signed out", anonClient()], ["secret key", secretClient()]] as const) {
      expect(await listPayments(client, id), name).toEqual({ ok: false, error: "forbidden" })
      expect(await listSeatPriorities(client, [id]), name).toEqual({ ok: false, error: "forbidden" })
      expect(await recordPayment(client, id, payment(300_000)), name).toEqual({ ok: false, error: "forbidden" })
      expect(await previewPayment(client, id, payment(300_000)), name).toEqual({ ok: false, error: "forbidden" })
    }
    // The secret key bypasses RLS, as it does on every table; only the
    // functions above refuse it.
    for (const [name, client] of [["leads.view only", viewer], ["signed out", anonClient()]] as const) {
      const { data } = await client.from("school_fee_payments").select("id").eq("lead_id", id)
      expect(data ?? [], name).toEqual([])
    }
  })
})

describe("the lead's history", () => {
  test("shows each payment to staff who may view payments, and hides it from everyone else", async () => {
    const id = await lead(await yearWithSchedule())
    const { paymentId } = await pay(await signedIn(ACCOUNTANT), id, payment(300_000, { paidOn: yesterday }))

    const history = await getLeadHistory(await signedIn(ADMISSIONS), id)
    if (!history.ok) throw new Error(history.error)
    const entry = history.data.entries.find((e) => e.record === "school_fee_payments")
    expect(entry).toMatchObject({ actor: ACCOUNTANT.name, recordId: paymentId, action: "insert" })
    expect(entry?.changes).toEqual(
      expect.arrayContaining([
        { field: "payment_type", from: null, to: "initial_deposit" },
        { field: "amount", from: null, to: 300_000 },
        { field: "paid_on", from: null, to: yesterday },
      ]),
    )

    const viewer = await createThrowawayStaff(["leads.view"])
    const hidden = await getLeadHistory(await signedIn(viewer), id)
    if (!hidden.ok) throw new Error(hidden.error)
    expect(hidden.data.entries.length).toBeGreaterThan(0)
    expect(hidden.data.entries.filter((e) => e.record === "school_fee_payments")).toEqual([])
  })
})
