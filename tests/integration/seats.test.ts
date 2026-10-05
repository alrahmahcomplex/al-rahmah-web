import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead, markLead } from "@/lib/services/lead-closure"
import { createLead, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"
import { previewPayment, recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { getSeats, seatCheck, type ClassSeats } from "@/lib/services/seats"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Seats (#111): counting, the warning before a payment that would overfill a
// class, the ranking of an over-full class, and seat_check, through the seats
// and payments modules against local Supabase, signed in as each seeded role.
//
// Each test claims a year of its own (tests/support/fee-years.ts). Claimed
// years are reused across runs and leads are never deleted, so a class may
// already hold leads from earlier runs: each test reads the class first and
// sets its seats relative to what it finds.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// KG 2 Boarding: TZS 3,000,000, so First instalment from 1,200,000 and
// Deposit from 300,000.
const CLASS: LeadClass = "KG 2"
const CHOICE: DayOrBoarding = "Boarding"
const FULL = 3_000_000
const FIRST = 1_200_000
const DEPOSIT = 300_000

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: FULL },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: DEPOSIT,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

// Sets a class's seats directly, whatever an earlier run left there. The
// Manager's own save is stale-checked and tested in academic-year.test.ts.
async function setSeats(year: number, seats: number, className: LeadClass = CLASS, choice: DayOrBoarding = CHOICE) {
  await asSystem((sql) =>
    sql.query(
      `insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values ($1, $2, $3, $4)
       on conflict (enrollment_year, class_name, day_or_boarding) do update set seats = excluded.seats`,
      [year, className, choice, seats],
    ),
  )
}

async function classIn(year: number, className: LeadClass = CLASS, choice: DayOrBoarding = CHOICE): Promise<ClassSeats> {
  const seats = await getSeats(await signedIn(MANAGER), year)
  if (!seats.ok) throw new Error(`getSeats failed: ${seats.error}`)
  const found = seats.data.find((entry) => entry.className === className && entry.dayOrBoarding === choice)
  if (!found) throw new Error(`no ${className} ${choice} in ${year}`)
  return found
}

// A class in `year` with no seats set, or null when every one has been set.
async function unsetClassIn(year: number): Promise<{ className: LeadClass; dayOrBoarding: DayOrBoarding } | null> {
  const seats = await getSeats(await signedIn(MANAGER), year)
  if (!seats.ok) throw new Error(`getSeats failed: ${seats.error}`)
  return seats.data.find((entry) => entry.seats === null) ?? null
}

function phone() {
  // A leading 5 keeps it clear of the seeded 700 000 numbers.
  return `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in lead in `year`, interviewed and Passed today.
async function passedLead(
  year: number,
  className: LeadClass = CLASS,
  choice: DayOrBoarding = CHOICE,
): Promise<{ id: string; admissionNumber: string }> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Seat Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Seated ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: choice },
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
  return { id, admissionNumber: created.data.admissionNumber }
}

async function pay(leadId: string, amount: number, overrides: Partial<PaymentInput> = {}) {
  const recorded = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "initial_deposit", amount, paidOn: today, ...overrides },
    randomUUID(),
  )
  if (!recorded.ok) throw new Error(`payment failed: ${recorded.error}`)
}

async function preview(leadId: string, amount: number, overrides: Partial<PaymentInput> = {}) {
  const previewed = await previewPayment(await signedIn(ACCOUNTANT), leadId, {
    type: "initial_deposit",
    amount,
    paidOn: today,
    ...overrides,
  })
  if (!previewed.ok) throw new Error(`preview failed: ${previewed.error}`)
  return previewed.data
}

describe("counting seats", () => {
  test("a lead takes a seat once it has a Seat priority, counted under that priority", async () => {
    const year = await yearWithSchedule()
    await setSeats(year, 30)
    const before = await classIn(year)
    expect(before.seats).toBe(30)

    const full = await passedLead(year)
    const first = await passedLead(year)
    const deposit = await passedLead(year)
    const none = await passedLead(year)
    await pay(full.id, FULL, { type: "full_payment" })
    await pay(first.id, FIRST)
    await pay(deposit.id, DEPOSIT)
    // Below the minimum deposit: no priority, no seat.
    await pay(none.id, DEPOSIT - 1)

    const after = await classIn(year)
    expect(after.taken).toBe(before.taken + 3)
    expect(after.full).toBe(before.full + 1)
    expect(after.firstInstalment).toBe(before.firstInstalment + 1)
    expect(after.deposit).toBe(before.deposit + 1)
    expect(after.taken).toBe(after.full + after.firstInstalment + after.deposit)
  })

  test("declining a lead frees its seat; Inactive and Archived leads keep theirs", async () => {
    const year = await yearWithSchedule()
    const declined = await passedLead(year)
    const inactive = await passedLead(year)
    const archived = await passedLead(year)
    for (const lead of [declined, inactive, archived]) await pay(lead.id, DEPOSIT)
    const before = await classIn(year)

    const manager = await signedIn(MANAGER)
    const declinedOk = await declineLead(manager, declined.id, { reason: "Fee payment not completed" })
    expect(declinedOk.ok).toBe(true)
    expect((await classIn(year)).taken).toBe(before.taken - 1)

    expect((await markLead(manager, inactive.id, { mark: "inactive", reason: "Duplicate record" })).ok).toBe(true)
    expect((await markLead(manager, archived.id, { mark: "archived", reason: "Duplicate record" })).ok).toBe(true)
    const after = await classIn(year)
    expect(after.taken).toBe(before.taken - 1)
    expect(after.deposit).toBe(before.deposit - 1)
  })

  test("every class is listed, Day before Boarding, with seats not set as null", async () => {
    const year = await yearWithSchedule()
    await setSeats(year, 30)
    const seats = await getSeats(await signedIn(MANAGER), year)
    if (!seats.ok) throw new Error(seats.error)
    expect(seats.data).toHaveLength(26)
    expect(seats.data.slice(0, 2).map((entry) => [entry.className, entry.dayOrBoarding])).toEqual([
      ["DAY CARE", "Day"],
      ["DAY CARE", "Boarding"],
    ])
    expect(seats.data.find((entry) => entry.className === CLASS && entry.dayOrBoarding === CHOICE)?.seats).toBe(30)
    const unset = await unsetClassIn(year)
    expect(unset).not.toBeNull()
  })
})

describe("the warning before a payment", () => {
  test("warns when the payment would give the lead a seat in a class already at capacity, and the payment still records", async () => {
    const year = await yearWithSchedule()
    const holder = await passedLead(year)
    await pay(holder.id, DEPOSIT)
    const { taken } = await classIn(year)
    await setSeats(year, taken)

    const lead = await passedLead(year)
    const answer = await preview(lead.id, DEPOSIT)
    expect(answer).toMatchObject({ priority: null, priorityAfter: "Deposit", wouldOverfill: true, seats: taken, seatsTaken: taken })

    await pay(lead.id, DEPOSIT)
    expect((await classIn(year)).taken).toBe(taken + 1)
  })

  test("warns when the class is already over capacity", async () => {
    const year = await yearWithSchedule()
    const holder = await passedLead(year)
    await pay(holder.id, DEPOSIT)
    await setSeats(year, 0)

    const lead = await passedLead(year)
    expect((await preview(lead.id, FULL, { type: "full_payment" })).wouldOverfill).toBe(true)
  })

  test("doesn't warn below capacity, without a priority after, or when the lead already holds a seat", async () => {
    const year = await yearWithSchedule()
    const { taken } = await classIn(year)
    await setSeats(year, taken + 1)

    const lead = await passedLead(year)
    // One seat left: taking it is not overfilling.
    expect((await preview(lead.id, DEPOSIT)).wouldOverfill).toBe(false)
    // A payment below the minimum deposit gives no seat.
    expect((await preview(lead.id, DEPOSIT - 1)).wouldOverfill).toBe(false)

    await pay(lead.id, DEPOSIT)
    expect((await classIn(year)).taken).toBe(taken + 1)
    // Now full, but the lead already holds its seat: a further payment only
    // raises its priority.
    expect(await preview(lead.id, FIRST)).toMatchObject({ priority: "Deposit", priorityAfter: "First instalment", wouldOverfill: false })
  })

  test("never warns for a class whose seats are not set", async () => {
    const year = await yearWithSchedule()
    const unset = await unsetClassIn(year)
    if (!unset) throw new Error(`every class in ${year} has seats set`)
    const holder = await passedLead(year, unset.className, unset.dayOrBoarding)
    await pay(holder.id, FULL * 2, { type: "full_payment" })

    const lead = await passedLead(year, unset.className, unset.dayOrBoarding)
    const answer = await preview(lead.id, FULL * 2, { type: "full_payment" })
    expect(answer).toMatchObject({ priorityAfter: "Full", wouldOverfill: false, seats: null })
  })
})

describe("ranking an over-full class", () => {
  test("ranks Full, then First instalment, then Deposit, then the date each was reached, then Admission Number", async () => {
    const year = await yearWithSchedule()
    // Three Deposit leads: two reaching it on the same day (a tie broken by
    // Admission Number) and one earlier.
    const depositLate = [await passedLead(year), await passedLead(year)]
    const depositEarly = await passedLead(year)
    const first = await passedLead(year)
    const full = await passedLead(year)
    for (const lead of depositLate) await pay(lead.id, DEPOSIT, { paidOn: yesterday })
    await pay(depositEarly.id, DEPOSIT, { paidOn: "2026-01-05" })
    await pay(first.id, FIRST, { paidOn: "2026-01-01" })
    await pay(full.id, FULL, { type: "full_payment", paidOn: yesterday })
    await setSeats(year, 1)

    const seats = await classIn(year)
    expect(seats.taken).toBeGreaterThan(1)
    const ranked = seats.ranked
    if (!ranked) throw new Error("an over-full class lists its leads")
    expect(ranked.map((entry) => entry.rank)).toEqual(ranked.map((_, index) => index + 1))

    const mine = [full, first, depositEarly, ...depositLate.toSorted((a, b) => a.admissionNumber.localeCompare(b.admissionNumber))]
    const order = ranked.filter((entry) => mine.some((lead) => lead.id === entry.leadId)).map((entry) => entry.leadId)
    expect(order).toEqual(mine.map((lead) => lead.id))
    expect(ranked.find((entry) => entry.leadId === full.id)).toMatchObject({
      admissionNumber: full.admissionNumber,
      priority: "Full",
      reachedOn: yesterday,
      closure: null,
    })
  })

  test("lists no ranking at or below capacity", async () => {
    const year = await yearWithSchedule()
    const lead = await passedLead(year)
    await pay(lead.id, DEPOSIT)
    const { taken } = await classIn(year)
    await setSeats(year, taken)
    expect((await classIn(year)).ranked).toBeNull()
  })
})

describe("seat_check", () => {
  test("a Declined lead with a priority would overfill a full class, and is ranked among its holders", async () => {
    const year = await yearWithSchedule()
    const holder = await passedLead(year)
    await pay(holder.id, DEPOSIT)
    const declined = await passedLead(year)
    await pay(declined.id, FULL, { type: "full_payment" })
    expect((await declineLead(await signedIn(MANAGER), declined.id, { reason: "Fee payment not completed" })).ok).toBe(true)
    const { taken } = await classIn(year)
    await setSeats(year, taken)

    const check = await seatCheck(await signedIn(MANAGER), declined.id)
    if (!check.ok) throw new Error(check.error)
    expect(check.data).toMatchObject({
      enrollmentYear: year,
      className: CLASS,
      dayOrBoarding: CHOICE,
      seats: taken,
      seatsTaken: taken,
      priority: "Full",
      holdsSeat: false,
      wouldOverfill: true,
    })
    const ranked = check.data.ranked ?? []
    expect(ranked).toHaveLength(taken + 1)
    expect(ranked.filter((entry) => entry.thisLead).map((entry) => entry.leadId)).toEqual([declined.id])
    const holderAt = ranked.findIndex((entry) => entry.leadId === holder.id)
    const declinedAt = ranked.findIndex((entry) => entry.leadId === declined.id)
    expect(declinedAt).toBeLessThan(holderAt)
  })

  test("says nothing to warn about for a lead holding its seat, a lead with no priority, or a class with room", async () => {
    const year = await yearWithSchedule()
    const holder = await passedLead(year)
    await pay(holder.id, DEPOSIT)
    const nobody = await passedLead(year)
    const { taken } = await classIn(year)
    await setSeats(year, taken)

    const manager = await signedIn(MANAGER)
    const holding = await seatCheck(manager, holder.id)
    expect(holding.ok && holding.data).toMatchObject({ holdsSeat: true, wouldOverfill: false, ranked: null })
    const none = await seatCheck(manager, nobody.id)
    expect(none.ok && none.data).toMatchObject({ priority: null, holdsSeat: false, wouldOverfill: false, ranked: null })

    const declined = await passedLead(year)
    await pay(declined.id, DEPOSIT)
    expect((await declineLead(manager, declined.id, { reason: "Fee payment not completed" })).ok).toBe(true)
    await setSeats(year, taken + 1)
    const roomy = await seatCheck(manager, declined.id)
    expect(roomy.ok && roomy.data).toMatchObject({ holdsSeat: false, wouldOverfill: false, ranked: null })
  })

  test("is for signed-in staff only, and changes nothing", async () => {
    const year = await yearWithSchedule()
    const lead = await passedLead(year)
    await pay(lead.id, DEPOSIT)

    for (const person of [ACCOUNTANT, ADMISSIONS, MANAGER]) {
      expect((await seatCheck(await signedIn(person), lead.id)).ok).toBe(true)
    }
    expect(await seatCheck(anonClient(), lead.id)).toEqual({ ok: false, error: "forbidden" })
    expect(await seatCheck(await signedIn(MANAGER), randomUUID())).toEqual({ ok: false, error: "not_found" })

    const definition = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select p.prosecdef, p.provolatile,
                has_function_privilege('anon', p.oid, 'execute') as anon,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p where p.oid = 'public.seat_check(uuid)'::regprocedure`,
      )
      return rows[0]
    })
    expect(definition).toEqual({ prosecdef: true, provolatile: "s", anon: false, authenticated: true })
  })
})

describe("who reads the seats", () => {
  test("the Accountant, Admissions Staff and the Manager read them; signed-out visitors and the secret key don't", async () => {
    const year = await yearWithSchedule()
    for (const person of [ACCOUNTANT, ADMISSIONS, MANAGER]) {
      const seats = await getSeats(await signedIn(person), year)
      expect(seats.ok && seats.data).toHaveLength(26)
    }
    expect(await getSeats(anonClient(), year)).toEqual({ ok: false, error: "forbidden" })
    expect(await getSeats(secretClient(), year)).toEqual({ ok: false, error: "forbidden" })
  })
})
