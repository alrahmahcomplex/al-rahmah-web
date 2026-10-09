import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { createLead, getLead, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"
import { approveReopeningRequest, raiseReopeningRequest } from "@/lib/services/reopening-requests"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { getSeats, seatCheck, type ClassSeats } from "@/lib/services/seats"

import { asSystem, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The seat check on approving a Reopening request (#103), through the lead
// closure, reopening and seats modules against local Supabase, signed in as
// each seeded role. The approver reads seat_check before deciding; it only
// advises, so approval goes ahead in a full class too.
//
// Each test claims a year of its own (tests/support/fee-years.ts). Claimed
// years are reused across runs and leads are never deleted, so each test
// reads the class first and sets its seats relative to what it finds.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// STD 3 Boarding: TZS 3,000,000, so Deposit from 300,000.
const CLASS: LeadClass = "STD 3"
const CHOICE: DayOrBoarding = "Boarding"

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

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

async function setSeats(year: number, seats: number) {
  await asSystem((sql) =>
    sql.query(
      `insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values ($1, $2, $3, $4)
       on conflict (enrollment_year, class_name, day_or_boarding) do update set seats = excluded.seats`,
      [year, CLASS, CHOICE, seats],
    ),
  )
}

async function classIn(year: number): Promise<ClassSeats> {
  const seats = await getSeats(await signedIn(MANAGER), year)
  if (!seats.ok) throw new Error(`getSeats failed: ${seats.error}`)
  const found = seats.data.find((entry) => entry.className === CLASS && entry.dayOrBoarding === CHOICE)
  if (!found) throw new Error(`no ${CLASS} ${CHOICE} in ${year}`)
  return found
}

// A walk-in lead in `year`, Passed today and holding a Deposit seat.
async function seatedLead(year: number): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    // A leading 5 keeps it clear of the seeded 700 000 numbers.
    guardian: { contact: { fullName: "Seat Parent", relationship: "Mother", phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}` } },
    student: { fullName: `Reseated ${randomUUID().slice(0, 8)}`, className: CLASS, enrollmentYear: thisYear + 1, dayOrBoarding: CHOICE },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  const paid = await recordPayment(await signedIn(ACCOUNTANT), id, DEPOSIT, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
  return id
}

// Declines the lead, freeing its seat, and raises a Reopening request.
async function requested(lead: string): Promise<string> {
  const declined = await declineLead(await signedIn(MANAGER), lead, { reason: "Fees or cost" })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  const raised = await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "The family found a sponsor.", source: "lead" })
  if (!raised.ok) throw new Error(`raise failed: ${JSON.stringify(raised.error)}`)
  return raised.data
}

async function approve(request: string) {
  return approveReopeningRequest(await signedIn(MANAGER), request, { enrolWithoutRetake: true })
}

async function statusOf(lead: string) {
  const read = await getLead(await signedIn(ADMISSIONS), lead)
  if (!read.ok) throw new Error(`no lead: ${read.error}`)
  return read.data.status
}

describe("the seat check on approving a reopening", () => {
  test("in a full class it warns with the ranking and this lead marked, and the approval still goes ahead", async () => {
    const year = await yearWithSchedule()
    await seatedLead(year)
    const lead = await seatedLead(year)
    const request = await requested(lead)
    const { taken } = await classIn(year)
    await setSeats(year, taken)

    const check = await seatCheck(await signedIn(MANAGER), lead)
    if (!check.ok) throw new Error(check.error)
    expect(check.data).toMatchObject({ seats: taken, seatsTaken: taken, priority: "Deposit", holdsSeat: false, wouldOverfill: true })
    const ranked = check.data.ranked ?? []
    expect(ranked).toHaveLength(taken + 1)
    expect(ranked.filter((entry) => entry.thisLead).map((entry) => entry.leadId)).toEqual([lead])

    expect(await approve(request)).toEqual({ ok: true, data: null })
    expect(await statusOf(lead)).toBe("Interviewed")
    // The lead took its seat back: the class now has more leads than seats.
    const after = await classIn(year)
    expect(after.taken).toBe(taken + 1)
    expect(after.ranked?.some((entry) => entry.leadId === lead)).toBe(true)
  })

  test("in a class with room it has nothing to warn about, and the approval goes ahead", async () => {
    const year = await yearWithSchedule()
    const lead = await seatedLead(year)
    const request = await requested(lead)
    const { taken } = await classIn(year)
    await setSeats(year, taken + 1)

    const check = await seatCheck(await signedIn(MANAGER), lead)
    expect(check.ok && check.data).toMatchObject({ seats: taken + 1, priority: "Deposit", holdsSeat: false, wouldOverfill: false, ranked: null })

    expect(await approve(request)).toEqual({ ok: true, data: null })
    expect(await statusOf(lead)).toBe("Interviewed")
    expect((await classIn(year)).taken).toBe(taken + 1)
  })

  test("reads only: checking the seats leaves the request Pending and the lead Declined", async () => {
    const year = await yearWithSchedule()
    const lead = await seatedLead(year)
    await requested(lead)
    await setSeats(year, 0)

    expect((await seatCheck(await signedIn(MANAGER), lead)).ok).toBe(true)
    expect(await statusOf(lead)).toBe("Declined")
    const { rows } = await asSystem((sql) =>
      sql.query<{ state: string }>("select state from public.reopening_requests where lead_id = $1", [lead]),
    )
    expect(rows.map((row) => row.state)).toEqual(["pending"])
  })
})
