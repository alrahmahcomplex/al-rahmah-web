import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { countYearInterviews, listInterviewYears, listYearInterviews, type InterviewListItem } from "@/lib/services/interview-list"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../support/interview-years"

// The Interviews screen's list, against local Supabase. The file claims an
// enrollment year of its own and registers four leads in it: one with no
// result yet, one Passed and Paid, one Failed and Not Paid, and one declined
// after registering. The year keeps every earlier run's rows, so tests look
// for these four among them and never count on the year's size.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

let claim: InterviewYearClaim
let year: number
const lead = { waiting: "", passed: "", failed: "", declined: "" }

async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      // A leading 6 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' 07 numbers.
      contact: { fullName: "List Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Listed ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Boarding" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

beforeAll(async () => {
  claim = await claimInterviewYear()
  year = claim.year

  const [waiting, passed, failed, declined] = await Promise.all([newLead(), newLead(), newLead(), newLead()])
  Object.assign(lead, { waiting, passed, failed, declined })
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = any($1)", [Object.values(lead), year]))

  // Registered one after another, so their S/Ns run in this order.
  const staff = await signedIn(ADMISSIONS)
  const interview: Record<string, string> = {}
  for (const [name, id] of Object.entries(lead)) {
    const registered = await registerForInterview(staff, id)
    if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
    interview[name] = registered.data.interviewId
  }

  for (const [name, result, score] of [
    ["passed", "Passed", 81.5],
    ["failed", "Failed", 37],
  ] as const) {
    const recorded = await recordInterviewResult(staff, interview[name], { interviewDate: today, result, score })
    if (!recorded.ok) throw new Error(`recording failed: ${recorded.error}`)
  }
  // Paid as the Accountant's fee panel leaves it: the amount locked.
  await asSystem((sql) =>
    sql.query("update public.interviews set fee_status = 'Paid', locked_amount = 50000, locked_discount_applied = false where id = $1", [interview.passed]),
  )

  const declinedLead = await declineLead(await signedIn(MANAGER), lead.declined, { reason: "Family changed plans" })
  if (!declinedLead.ok) throw new Error(`decline failed: ${declinedLead.error}`)
})

afterAll(async () => {
  await claim?.release()
})

// The whole year's list.
async function yearRows(client: SupabaseClient, enrollmentYear: number, chunk?: number) {
  const listed = await listYearInterviews(client, enrollmentYear, chunk ? { chunk } : undefined)
  if (!listed.ok) throw new Error(`listing failed: ${listed.error}`)
  return listed.data
}

function ours(rows: InterviewListItem[]) {
  const names = Object.fromEntries(Object.entries(lead).map(([name, id]) => [id, name]))
  return rows.filter((row) => row.lead.id in names).map((row) => names[row.lead.id])
}

async function rowCount(query: string, params: unknown[]) {
  return inRolledBackTransaction(async (sql) => Number((await sql.query<{ count: string }>(query, params)).rows[0].count))
}

describe("listing an enrollment year's interviews", () => {
  test("lists every registration of the year in S/N order, each with its lead's details, result and fee", async () => {
    const rows = await yearRows(await signedIn(ADMISSIONS), year)

    expect(rows.length).toBe(await rowCount("select count(*) from public.interviews where serial_year = $1", [year]))
    const numbers = rows.map((row) => row.serialNumber)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(ours(rows)).toEqual(["waiting", "passed", "failed", "declined"])

    const passed = rows.find((row) => row.lead.id === lead.passed)
    expect(passed).toEqual({
      id: expect.any(String),
      serialNumber: expect.any(Number),
      registeredAt: expect.any(String),
      lead: {
        id: lead.passed,
        admissionNumber: expect.stringMatching(/^ADMSN-\d{5}$/),
        studentName: expect.stringMatching(/^Listed /),
        className: "STD 2",
        dayOrBoarding: "Boarding",
        status: "Interviewed",
        closure: null,
        closed: false,
      },
      result: "Passed",
      score: 81.5,
      feeStatus: "Paid",
    })
    // Registered today, as the screen's date column and date choice read it.
    expect(tanzaniaToday(new Date(passed!.registeredAt))).toBe(today)
    expect(rows.find((row) => row.lead.id === lead.waiting)).toMatchObject({ result: null, score: null, feeStatus: "Not Paid" })
    expect(rows.find((row) => row.lead.id === lead.failed)).toMatchObject({ result: "Failed", score: 37, feeStatus: "Not Paid" })
  })

  test("keeps a closed lead on the list, marked as closed, so the S/Ns have no gaps", async () => {
    const rows = await yearRows(await signedIn(ADMISSIONS), year)
    expect(rows.find((row) => row.lead.id === lead.declined)).toMatchObject({
      lead: { status: "Declined", closure: null, closed: true },
      result: null,
      feeStatus: "Not Paid",
    })
  })

  test("reads a year bigger than one request in chunks, missing and repeating none", async () => {
    const staff = await signedIn(ADMISSIONS)
    const whole = await yearRows(staff, year)
    expect(whole.length).toBeGreaterThan(3)
    const chunked = await yearRows(staff, year, 3)
    expect(chunked.map((row) => row.id)).toEqual(whole.map((row) => row.id))
  })

  test("counts the year's registrations for the year list", async () => {
    const counted = await countYearInterviews(await signedIn(ADMISSIONS), year)
    expect(counted).toEqual({ ok: true, data: await rowCount("select count(*) from public.interviews where serial_year = $1", [year]) })
  })

  test("shows the Accountant the same list", async () => {
    expect(ours(await yearRows(await signedIn(ACCOUNTANT), year))).toEqual(["waiting", "passed", "failed", "declined"])
  })

  test("lists only the year asked for", async () => {
    expect(ours(await yearRows(await signedIn(ADMISSIONS), thisYear + 1))).toEqual([])
  })

  test("offers the years that have registrations", async () => {
    const years = await listInterviewYears(await signedIn(ACCOUNTANT))
    expect(years.ok).toBe(true)
    if (!years.ok) return
    expect(years.data).toContain(year)
    expect(years.data).toContain(2027)
    expect(years.data).toEqual([...years.data].sort((a, b) => a - b))
  })

  test("shows nothing to a visitor or to staff who may not view leads", async () => {
    const outsider = await signedIn(await createThrowawayStaff(["payments.view"]))
    for (const client of [anonClient(), outsider]) {
      expect(await listYearInterviews(client, year)).toEqual({ ok: true, data: [] })
      expect(await countYearInterviews(client, year)).toEqual({ ok: true, data: 0 })
      expect(await listInterviewYears(client)).toEqual({ ok: true, data: [] })
    }
  })
})
