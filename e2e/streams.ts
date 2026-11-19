import { randomInt, randomUUID } from "node:crypto"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, type LeadClass, type StudentGender } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { openStream, type StreamTakes } from "@/lib/services/streams"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../tests/support/fixtures"
import { classesWithoutSeatHolders, removeStreams } from "../tests/support/stream-rows"

// Fixtures for the specs about streams (#449): a claimed fee year with one
// class nobody holds a seat in yet, children in it, and streams opened as
// the Manager. Streams are never deleted by the app, and the claimed years
// are reused, so each spec takes the year's streams away again when it ends:
// a later test that claims the year must find no seat limit there.

const DAY = 24 * 60 * 60 * 1000
export const today = tanzaniaToday()
export const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

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

// Day classes where the 300,000 deposit gives Deposit, the first Seat
// priority, and no Pre-Form One programme applies.
const CLASSES: LeadClass[] = ["KG 1", "KG 2", "STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7"]

export type StreamYear = { year: number; className: LeadClass; done: () => Promise<void> }

/**
 * A claimed year with a Fee schedule and a class where nobody holds a seat
 * and no stream is open. Call `done` when the test ends: it removes the
 * year's streams and gives the year back.
 */
export async function streamYear(): Promise<StreamYear> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const claim = await claimFeeYear()
    try {
      const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
      if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
      // Whatever a run that stopped early left behind.
      await removeStreams([claim.year])
      const [className] = (await classesWithoutSeatHolders(claim.year, CLASSES)) as LeadClass[]
      if (className) {
        return {
          year: claim.year,
          className,
          done: async () => {
            await removeStreams([claim.year])
            await claim.release()
          },
        }
      }
    } catch (error) {
      await claim.release()
      throw error
    }
    await claim.release()
  }
  throw new Error("No fee test year has a class without seat holders; run npm run db:reset")
}

/** A walk-in Day child of `year` and `className`, interviewed and Passed, with no payment yet. */
export async function pupil(year: number, className: LeadClass, gender?: StudentGender): Promise<{ id: string; name: string }> {
  const admissions = await signedIn(ADMISSIONS)
  const name = `Seat ${randomUUID().slice(0, 6)}`
  // A leading 5 keeps it clear of the seeded 700 000 numbers.
  const phone = `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone } },
    student: { fullName: name, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day", ...(gender ? { gender } : {}) },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(registered.error)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(recorded.error)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return { id, name }
}

/** The Accountant records the child's Initial deposit, which gives the Deposit priority. */
export async function payDeposit(leadId: string, paidOn: string = today): Promise<void> {
  const paid = await recordPayment(await signedIn(ACCOUNTANT), leadId, { type: "initial_deposit", amount: 300_000, paidOn }, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
}

/** The Manager opens a stream; the children already holding a seat priority there take its seats in ranking order. */
export async function open(year: number, className: LeadClass, label: string, takes: StreamTakes, seats: number): Promise<void> {
  const opened = await openStream(await signedIn(MANAGER), { year, className, label, takes, seats, requestId: randomUUID() })
  if (!opened.ok) throw new Error(`stream failed: ${opened.error}`)
}
