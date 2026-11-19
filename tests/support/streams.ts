import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { afterAll } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, type DayOrBoarding, type StudentGender } from "@/lib/services/leads"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { actAsStaff, asSystem, signedIn } from "./db"
import { claimFeeYear } from "./fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "./fixtures"
import { classesWithoutSeatHolders } from "./stream-rows"

export { removeStreams } from "./stream-rows"

// Helpers for the streams tests (#449). The seat mode is `named` since the
// activation migration (20270113100100). Children get their Seat priority
// from committed payments in a claimed fee year, in classes with no stream
// yet, so nothing places them. Streams are opened inside each test's own
// rolled-back transaction, so nothing reaches the rest of the suite; a test
// that commits streams removes them again (removeStreams). Local databases
// keep every committed lead and fee test years are reused, so a test that
// counts seats takes classes where nobody in its year holds one yet.

const DAY = 24 * 60 * 60 * 1000
export const today = tanzaniaToday()
export const thisYear = Number(today.slice(0, 4))
export const daysAgo = (n: number) => tanzaniaToday(new Date(Date.now() - n * DAY))

export const AMOUNTS: FeeAmounts = {
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

const CLASSES = ["DAY CARE", "KG 1", "KG 2", "STD 1", "STD 2", "STD 3", "STD 4", "STD 5", "STD 6", "STD 7", "FORM 1", "FORM 2", "FORM 3"]

/**
 * Years claimed for one test file, shared by its tests so the file saves
 * few fee schedules (other files compare fee_schedules rows while they run).
 * Call at the top level of the file.
 */
export function streamYears(amounts: FeeAmounts = AMOUNTS) {
  const releases: (() => Promise<void>)[] = []
  afterAll(async () => {
    for (const release of releases) await release()
  })
  let shared: number | null = null

  async function claimYear(): Promise<number> {
    const claim = await claimFeeYear()
    releases.push(claim.release)
    const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, amounts)
    if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
    return claim.year
  }

  /** The shared year and `n` of its classes (from `among`) where nobody holds a seat yet. */
  return async function yearAndClasses(n: number, among: string[] = CLASSES): Promise<{ year: number; classes: string[] }> {
    shared ??= await claimYear()
    const free = await classesWithoutSeatHolders(shared, among)
    if (free.length >= n) return { year: shared, classes: free.slice(0, n) }
    shared = await claimYear()
    const fresh = await classesWithoutSeatHolders(shared, among)
    if (fresh.length < n) throw new Error(`not enough classes of ${shared} without seat holders`)
    return { year: shared, classes: fresh.slice(0, n) }
  }
}

const phone = () => `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`

/** A child of `year` and `className` who passed their interview, with no payment yet. */
export async function child(year: number, className: string, gender?: StudentGender, dayOrBoarding: DayOrBoarding = "Day"): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Stream Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: phone() } },
    student: {
      fullName: `Stream ${randomUUID().slice(0, 8)}`,
      className: className as never,
      enrollmentYear: thisYear + 1,
      dayOrBoarding,
      ...(gender ? { gender } : {}),
    },
    start: { kind: "walk-in", visitDate: daysAgo(1) },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return id
}

/**
 * A child holding a Deposit priority reached `paidDaysAgo` days ago (older
 * ranks first). `payment` changes what was paid, and so the priority.
 */
export async function holder(
  year: number,
  className: string,
  gender: StudentGender | undefined,
  paidDaysAgo: number,
  { dayOrBoarding = "Day", payment = {} }: { dayOrBoarding?: DayOrBoarding; payment?: Partial<Pick<PaymentInput, "type" | "amount">> } = {},
): Promise<string> {
  const id = await child(year, className, gender, dayOrBoarding)
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    id,
    { type: "initial_deposit", amount: 300_000, ...payment, paidOn: daysAgo(paidDaysAgo) },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(`payment failed: ${JSON.stringify(paid.error)}`)
  return id
}

/**
 * Counts seats in streams for this transaction and acts as the Manager. The
 * mode is `named` already; the update is for a transaction that put it back
 * to `legacy`, and touches no row otherwise, so tests don't queue on it.
 */
export async function named(sql: Client) {
  await sql.query("select public.set_audit_actor('system')")
  await sql.query("update public.seat_settings set mode = 'named' where mode <> 'named'")
  await actAsStaff(sql, MANAGER.id)
}

/**
 * Puts this transaction back to how seats were counted before streams, and
 * acts as the Manager: for tests of what the clean-up slice removes. Only
 * inside a rolled-back transaction; nothing else may see `legacy` again.
 */
export async function legacy(sql: Client) {
  await sql.query("select public.set_audit_actor('system')")
  await sql.query("update public.seat_settings set mode = 'legacy' where mode <> 'legacy'")
  await actAsStaff(sql, MANAGER.id)
}

export async function asOwner(sql: Client) {
  await sql.query("reset role")
}

export type Stream = { id: string; label: string; takes: string; seats: number; position: number; placed: number }

export async function open(sql: Client, year: number, className: string, label: string, takes: string, seats: number): Promise<Stream> {
  const { rows } = await sql.query<{ s: Stream }>("select public.open_stream($1, $2, $3, $4, $5, $6) as s", [
    year, className, label, takes, seats, randomUUID(),
  ])
  return rows[0].s
}

/** Where each child sits: their stream's label, or null. */
export async function placements(sql: Client, ids: string[]): Promise<Record<string, string | null>> {
  const { rows } = await sql.query<{ lead_id: string; label: string | null }>(
    `select l.id as lead_id, s.label
     from public.leads l
     left join public.seat_placements p on p.lead_id = l.id
     left join public.streams s on s.id = p.stream_id
     where l.id = any ($1)`,
    [ids],
  )
  return Object.fromEntries(ids.map((id) => [id, rows.find((r) => r.lead_id === id)?.label ?? null]))
}

/** The error a statement raises, or "no refusal", leaving the transaction usable. */
export async function refusal(sql: Client, query: string, params: unknown[]): Promise<string> {
  await sql.query("savepoint refusal")
  try {
    await sql.query(query, params)
    return "no refusal"
  } catch (error) {
    return (error as Error).message
  } finally {
    await sql.query("rollback to savepoint refusal")
  }
}
