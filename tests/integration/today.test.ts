import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { releaseResult } from "@/lib/services/result-release"
import { countResultsReadyToSend, INTERVIEWS_NAMED, LATEST_LEADS, listInterviewsOn, listLatestLeads } from "@/lib/services/today"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn, whileUnchanged } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../support/interview-years"

// The Today page's reads (#226) against local Supabase. The file claims an
// enrollment year of its own for the interviews it registers; the year keeps
// earlier runs' rows, so tests look only for what they planted or compare a
// read with the database's own answer, read just before and just after it.

const OFFICE = { officePhone: "+255 673 526 644" }
const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

let claim: InterviewYearClaim
let year: number

beforeAll(async () => {
  claim = await claimInterviewYear()
  year = claim.year
})

afterAll(async () => {
  await claim?.release()
})

// A lead of the test's own, moved into the claimed year, and its interview.
async function registeredLead(studentName: string) {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      // A leading 6 keeps it clear of the seeded 700 000 numbers.
      contact: { fullName: "Today Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: studentName, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
  const registered = await registerForInterview(await signedIn(ADMISSIONS), leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return { leadId, interviewId: registered.data.interviewId }
}

// Acts as `staffId`'s signed-in session inside `sql`'s transaction, the way
// the API would, so a direct read follows the same row-level security.
async function asStaff(sql: Client, staffId: string) {
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  await sql.query("set local role authenticated")
}

describe("listInterviewsOn", () => {
  // A day of its own, far in the past, so no other test's interviews fall on
  // it: results recorded on that day for four interviews, in S/N order, and
  // one the day after.
  const dayNumber = randomInt(0, 9_000)
  const date = new Date(Date.UTC(2001, 0, 1 + dayNumber)).toISOString().slice(0, 10)
  const dayAfter = new Date(Date.UTC(2001, 0, 2 + dayNumber)).toISOString().slice(0, 10)
  const students = ["Today Alpha", "Today Bravo", "Today Charlie", "Today Delta"].map((name) => `${name} ${randomUUID().slice(0, 8)}`)
  const later = `Today Echo ${randomUUID().slice(0, 8)}`

  beforeAll(async () => {
    const interviews: string[] = []
    for (const name of students) interviews.push((await registeredLead(name)).interviewId)
    const after = await registeredLead(later)
    await asSystem(async (sql) => {
      await sql.query("update public.interviews set interview_date = $2, result = 'Passed', score = 70 where id = any($1)", [interviews, date])
      await sql.query("update public.interviews set interview_date = $2, result = 'Failed', score = 40 where id = $1", [after.interviewId, dayAfter])
    })
  })

  test("counts the day's interviews and names the first three by S/N", async () => {
    const read = await listInterviewsOn(await signedIn(ADMISSIONS), date)
    expect(read).toEqual({ ok: true, data: { count: 4, students: students.slice(0, INTERVIEWS_NAMED), year } })
  })

  test("names everyone when three or fewer were held", async () => {
    const read = await listInterviewsOn(await signedIn(MANAGER), dayAfter)
    expect(read).toEqual({ ok: true, data: { count: 1, students: [later], year } })
  })

  test("reads an empty day as nothing", async () => {
    const empty = new Date(Date.UTC(2000, 0, 1 + randomInt(0, 300))).toISOString().slice(0, 10)
    expect(await listInterviewsOn(await signedIn(ACCOUNTANT), empty)).toEqual({ ok: true, data: { count: 0, students: [], year: null } })
  })

  test("reads nothing for someone signed out or without leads.view", async () => {
    expect(await listInterviewsOn(anonClient(), date)).toEqual({ ok: true, data: { count: 0, students: [], year: null } })
    const cashier = await createThrowawayStaff(["payments.view"])
    expect(await listInterviewsOn(await signedIn(cashier), date)).toEqual({ ok: true, data: { count: 0, students: [], year: null } })
  })
})

describe("countResultsReadyToSend", () => {
  // Three leads of the test's own: a paid result nobody has sent, a result
  // with its fee unpaid, and a paid result already sent.
  const planted = { ready: "", unpaid: "", sent: "" }

  beforeAll(async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const name of ["ready", "unpaid", "sent"] as const) {
      const { interviewId } = await registeredLead(`Today ${name} ${randomUUID().slice(0, 8)}`)
      const recorded = await recordInterviewResult(staff, interviewId, { interviewDate: today, result: "Passed", score: 68 })
      if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
      if (name !== "unpaid") {
        const marked = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")
        if (!marked.ok) throw new Error(`fee failed: ${marked.error}`)
      }
      if (name === "sent") {
        const released = await releaseResult(staff, interviewId, "sms", OFFICE)
        if (!released.ok) throw new Error(`release failed: ${released.error}`)
      }
      planted[name] = interviewId
    }
  })

  test("counts the seeded paid results nobody has sent, from the earliest year with one", async () => {
    // supabase/seeds/50_interviews.sql and 60_results.sql: ADMSN-90503 in
    // 2027, and four 2028 results, all Paid and never sent.
    const read = await countResultsReadyToSend(await signedIn(ADMISSIONS))
    if (!read.ok) throw new Error(`count refused: ${read.error}`)
    expect(read.data.count).toBeGreaterThanOrEqual(5)
    expect(read.data.year).not.toBeNull()
    expect(read.data.year!).toBeLessThanOrEqual(2027)
  })

  test("agrees with the database's Ready to send rule, which takes the paid unsent result and leaves out the unpaid and the sent", async () => {
    const admissions = await signedIn(ADMISSIONS)
    // The rule's answer as Admissions, read before and after the service's,
    // until no test registered, recorded, paid, sent or closed meanwhile.
    const { state, result: read } = await whileUnchanged(
      async (sql) => {
        await sql.query("begin")
        try {
          await asStaff(sql, ADMISSIONS.id)
          const { rows } = await sql.query<{ count: string; year: number | null; ids: string | null }>(
            `select count(*) as count, min(i.serial_year) as year, md5(string_agg(i.id::text, ',' order by i.id)) as ids
             from public.interviews i where public.result_ready_to_send(i)`,
          )
          return rows[0]
        } finally {
          await sql.query("rollback")
        }
      },
      () => countResultsReadyToSend(admissions),
    )
    if (!read.ok) throw new Error(`count refused: ${read.error}`)
    expect(read.data).toEqual({ count: Number(state.count), year: state.year })

    await inRolledBackTransaction(async (sql) => {
      await asStaff(sql, ADMISSIONS.id)
      const each = await sql.query<{ id: string; ready: boolean }>(
        "select i.id, public.result_ready_to_send(i) as ready from public.interviews i where i.id = any($1)",
        [Object.values(planted)],
      )
      const ready = Object.fromEntries(each.rows.map((row) => [row.id, row.ready]))
      expect(ready).toEqual({ [planted.ready]: true, [planted.unpaid]: false, [planted.sent]: false })
    })
  })

  test("reads zero for someone signed out", async () => {
    expect(await countResultsReadyToSend(anonClient())).toEqual({ ok: true, data: { count: 0, year: null } })
  })
})

describe("listLatestLeads", () => {
  test("lists the newest leads first, five of them, as the database orders them", async () => {
    await registeredLead(`Today newest ${randomUUID().slice(0, 8)}`)
    const manager = await signedIn(MANAGER)
    const accountant = await signedIn(ACCOUNTANT)
    // The database's newest leads, read before and after the service's,
    // until no test created or changed one of them meanwhile.
    const {
      state: rows,
      result: [read, two],
    } = await whileUnchanged(
      async (sql) =>
        (
          await sql.query<{ id: string; version: string }>(
            "select id, xmin::text as version from public.leads order by created_at desc, id desc limit $1",
            [LATEST_LEADS],
          )
        ).rows,
      () => Promise.all([listLatestLeads(manager), listLatestLeads(accountant, 2)]),
    )
    if (!read.ok) throw new Error(`list refused: ${read.error}`)
    if (!two.ok) throw new Error(`list refused: ${two.error}`)

    expect(read.data).toHaveLength(LATEST_LEADS)
    expect(read.data.map((lead) => lead.id)).toEqual(rows.map((row) => row.id))
    for (const lead of read.data) {
      expect(lead.admissionNumber).toMatch(/^ADMSN-\d{5}$/)
      expect(lead.studentName).not.toBe("")
      expect(["Applied", "Visited", "Interviewed", "Enrolled", "Declined"]).toContain(lead.status)
    }
    const createdAt = read.data.map((lead) => Date.parse(lead.createdAt))
    expect(createdAt).toEqual([...createdAt].sort((a, b) => b - a))

    expect(two.data.map((lead) => lead.id)).toEqual(rows.slice(0, 2).map((row) => row.id))
  })

  test("reads nothing for someone signed out", async () => {
    expect(await listLatestLeads(anonClient())).toEqual({ ok: true, data: [] })
  })
})
