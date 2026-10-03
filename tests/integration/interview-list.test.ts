import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  INTERVIEWS_PER_PAGE,
  listInterviews,
  listInterviewYears,
  type InterviewListItem,
  type InterviewListSearch,
} from "@/lib/services/interview-list"
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
    sql.query("update public.interviews set fee_status = 'Paid', locked_amount = 50000 where id = $1", [interview.passed]),
  )

  const declinedLead = await declineLead(await signedIn(MANAGER), lead.declined, { reason: "Family changed plans" })
  if (!declinedLead.ok) throw new Error(`decline failed: ${declinedLead.error}`)
})

afterAll(async () => {
  await claim?.release()
})

// Every page of a list, in order.
async function everyRow(client: SupabaseClient, search: Omit<InterviewListSearch, "page">) {
  const rows: InterviewListItem[] = []
  for (let page = 1; ; page++) {
    const listed = await listInterviews(client, { ...search, page })
    if (!listed.ok) throw new Error(`listing failed: ${listed.error}`)
    rows.push(...listed.data.interviews)
    if (page >= listed.data.pageCount) return { rows, total: listed.data.total }
  }
}

function ours(rows: InterviewListItem[]) {
  const names = Object.fromEntries(Object.entries(lead).map(([name, id]) => [id, name]))
  return rows.filter((row) => row.lead.id in names).map((row) => names[row.lead.id])
}

async function rowCount(query: string, params: unknown[]) {
  return inRolledBackTransaction(async (sql) => Number((await sql.query<{ count: string }>(query, params)).rows[0].count))
}

describe("listing an enrollment year's interviews", () => {
  test("lists the year's registrations in S/N order, each with its lead's details, result and fee", async () => {
    const { rows, total } = await everyRow(await signedIn(ADMISSIONS), { enrollmentYear: year })

    expect(total).toBe(await rowCount("select count(*) from public.interviews where serial_year = $1", [year]))
    const numbers = rows.map((row) => row.serialNumber)
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b))
    expect(new Set(numbers).size).toBe(numbers.length)
    expect(ours(rows)).toEqual(["waiting", "passed", "failed", "declined"])

    const passed = rows.find((row) => row.lead.id === lead.passed)
    expect(passed).toEqual({
      id: expect.any(String),
      serialNumber: expect.any(Number),
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
    expect(rows.find((row) => row.lead.id === lead.waiting)).toMatchObject({ result: null, score: null, feeStatus: "Not Paid" })
    expect(rows.find((row) => row.lead.id === lead.failed)).toMatchObject({ result: "Failed", score: 37, feeStatus: "Not Paid" })
  })

  test("keeps a closed lead on the list, marked as closed, so the S/Ns have no gaps", async () => {
    const { rows } = await everyRow(await signedIn(ADMISSIONS), { enrollmentYear: year })
    expect(rows.find((row) => row.lead.id === lead.declined)).toMatchObject({
      lead: { status: "Declined", closure: null, closed: true },
      result: null,
      feeStatus: "Not Paid",
    })
  })

  test("filters by result and by fee status, alone and together", async () => {
    const staff = await signedIn(ADMISSIONS)
    const cases = [
      [{ result: "none" }, ["waiting", "declined"]],
      [{ result: "Passed" }, ["passed"]],
      [{ result: "Failed" }, ["failed"]],
      [{ feeStatus: "Paid" }, ["passed"]],
      [{ feeStatus: "Not Paid" }, ["waiting", "failed", "declined"]],
      [{ result: "Failed", feeStatus: "Not Paid" }, ["failed"]],
      [{ result: "Passed", feeStatus: "Not Paid" }, []],
    ] as const

    for (const [filters, expected] of cases) {
      const { result, feeStatus }: Pick<InterviewListSearch, "result" | "feeStatus"> = filters
      const { rows } = await everyRow(staff, { enrollmentYear: year, result, feeStatus })
      expect(ours(rows), JSON.stringify(filters)).toEqual(expected)
      // Every row shown, not only this file's, matches the filters.
      for (const row of rows) {
        if (result) expect(row.result).toBe(result === "none" ? null : result)
        if (feeStatus) expect(row.feeStatus).toBe(feeStatus)
      }
    }
  })

  test("shows the Accountant the same list, so Not Paid shows who still owes", async () => {
    const { rows } = await everyRow(await signedIn(ACCOUNTANT), { enrollmentYear: year, feeStatus: "Not Paid" })
    expect(ours(rows)).toEqual(["waiting", "failed", "declined"])
  })

  test("lists only the year asked for", async () => {
    const { rows } = await everyRow(await signedIn(ADMISSIONS), { enrollmentYear: thisYear + 1 })
    expect(ours(rows)).toEqual([])
  })

  test("pages through the year, fifty to a page, in S/N order", async () => {
    // At least one more row than a page holds. Rows earlier runs left count.
    const have = await rowCount("select count(*) from public.interviews where serial_year = $1", [year])
    const needed = INTERVIEWS_PER_PAGE + 1 - have
    if (needed > 0) await addRegistrations(needed)
    const total = await rowCount("select count(*) from public.interviews where serial_year = $1", [year])

    const staff = await signedIn(ADMISSIONS)
    const first = await listInterviews(staff, { enrollmentYear: year, page: 1 })
    const second = await listInterviews(staff, { enrollmentYear: year, page: 2 })
    if (!first.ok || !second.ok) throw new Error("listing failed")

    expect(first.data).toMatchObject({ total, page: 1, pageCount: Math.ceil(total / INTERVIEWS_PER_PAGE) })
    expect(first.data.interviews).toHaveLength(INTERVIEWS_PER_PAGE)
    expect(second.data.page).toBe(2)
    expect(second.data.interviews.length).toBe(Math.min(INTERVIEWS_PER_PAGE, total - INTERVIEWS_PER_PAGE))
    expect(second.data.interviews[0].serialNumber).toBeGreaterThan(first.data.interviews.at(-1)!.serialNumber)

    // A page past the end is empty, and still says how many there are.
    const past = await listInterviews(staff, { enrollmentYear: year, page: first.data.pageCount + 1 })
    expect(past).toEqual({ ok: true, data: { interviews: [], total, page: first.data.pageCount + 1, pageCount: first.data.pageCount } })
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
      expect(await listInterviews(client, { enrollmentYear: year, page: 1 })).toEqual({
        ok: true,
        data: { interviews: [], total: 0, page: 1, pageCount: 1 },
      })
      expect(await listInterviewYears(client)).toEqual({ ok: true, data: [] })
    }
  })
})

// Registrations made straight in the database for the paging test, each on a
// Visited lead of its own, numbered on from the year's counter as
// register_for_interview would.
async function addRegistrations(count: number) {
  await asSystem(async (sql) => {
    const contact = await sql.query<{ guardian_contact_id: string }>("select guardian_contact_id from public.leads where id = $1", [
      lead.waiting,
    ])
    const counter = await sql.query<{ last_number: number }>(
      "select last_number from public.interview_serial_counters where enrollment_year = $1 for update",
      [year],
    )
    const numbers = await sql.query<{ admission_number: string }>(
      `select format('ADMSN-%s', lpad(n::text, 5, '0')) as admission_number
         from generate_series(0, 99999) n
        where not exists (select 1 from public.leads l where l.admission_number = format('ADMSN-%s', lpad(n::text, 5, '0')))
        order by random() limit $1`,
      [count],
    )
    const leads = await sql.query<{ id: string }>(
      `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date, guardian_contact_id)
       select number, 'Paged ' || number, 'STD 1', $2, 'Day', 'Visited', $3::date, $4
         from unnest($1::text[]) with ordinality as t(number, position)
        order by position
       returning id`,
      [numbers.rows.map((row) => row.admission_number), year, today, contact.rows[0].guardian_contact_id],
    )
    await sql.query(
      `insert into public.interviews (lead, serial_number, serial_year, registered_by)
       select id, $2 + position, $3, $4 from unnest($1::uuid[]) with ordinality as t(id, position)`,
      [leads.rows.map((row) => row.id), counter.rows[0].last_number, year, ADMISSIONS.id],
    )
    await sql.query("update public.interview_serial_counters set last_number = last_number + $2 where enrollment_year = $1", [
      year,
      count,
    ])
  })
}
