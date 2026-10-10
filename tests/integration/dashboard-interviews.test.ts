import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test } from "vitest"

import { getMetricCount, listEnrollmentYears, type DashboardMetric, type Period } from "@/lib/services/dashboard"
import { recordInterviewResult } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { tanzaniaToday } from "@/lib/school-calendar"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, lockExclusively, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"
import { claimInterviewYear, type InterviewYearClaim } from "../support/interview-years"

// Interviewed leads, Passed interviews and Failed interviews against local
// Supabase. Counts are filtered to Enrollment year 2031, the dashboard's own
// fixtures in supabase/seeds/95_dashboard.sql, so no other test's interviews
// shift them. The seed's header lists every 2031 interview.

const YEAR = 2031

type Counts = { interviewed: number; passed: number; failed: number }

async function count(
  supabase: SupabaseClient,
  metric: DashboardMetric,
  period: Period,
  enrollmentYear: number | null = YEAR,
): Promise<number> {
  const result = await getMetricCount(supabase, metric, { period, enrollmentYear })
  if (!result.ok) throw new Error(`count refused: ${result.error}`)
  return result.data
}

// The three interview counts for one period and Enrollment year.
async function counts(supabase: SupabaseClient, period: Period, enrollmentYear: number | null = YEAR): Promise<Counts> {
  const [interviewed, passed, failed] = await Promise.all([
    count(supabase, "interviewed_leads", period, enrollmentYear),
    count(supabase, "passed_interviews", period, enrollmentYear),
    count(supabase, "failed_interviews", period, enrollmentYear),
  ])
  return { interviewed, passed, failed }
}

const ALL: Period = { kind: "all" }
const date = (anchor: string): Period => ({ kind: "date", anchor })
const week = (anchor: string): Period => ({ kind: "week", anchor })
const month = (anchor: string): Period => ({ kind: "month", anchor })
const year = (anchor: string): Period => ({ kind: "year", anchor })

describe("the interview counts", () => {
  test("All time: Interviewed leads counts children, Passed and Failed count sittings", async () => {
    // Twenty-two 2031 sittings with a result, on twenty-one children:
    // ADMSN-31015 sat twice. One registration has no result yet. Ten of the
    // passes are the Enrolled students fixtures', on 19 November 2025.
    expect(await counts(await signedIn(MANAGER), ALL)).toEqual({ interviewed: 21, passed: 16, failed: 6 })
  })

  test("Date counts one day", async () => {
    const manager = await signedIn(MANAGER)
    expect(await counts(manager, date("2026-09-27"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
    expect(await counts(manager, date("2026-09-28"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
    expect(await counts(manager, date("2026-09-26"))).toEqual({ interviewed: 0, passed: 0, failed: 0 })
  })

  test("Week runs Monday to Sunday, whichever day anchors it", async () => {
    const manager = await signedIn(MANAGER)
    // Sunday 27 September ends the week of 21 September.
    expect(await counts(manager, week("2026-09-21"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
    expect(await counts(manager, week("2026-09-27"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
    // Monday 28 September starts the next, which runs into October.
    expect(await counts(manager, week("2026-09-28"))).toEqual({ interviewed: 6, passed: 3, failed: 3 })
    expect(await counts(manager, week("2026-10-04"))).toEqual({ interviewed: 6, passed: 3, failed: 3 })
    // A week across a year end.
    expect(await counts(manager, week("2025-12-31"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
  })

  test("Month is the calendar month", async () => {
    const manager = await signedIn(MANAGER)
    // 30 September ends September; 1 October starts October.
    expect(await counts(manager, month("2026-09-01"))).toEqual({ interviewed: 6, passed: 3, failed: 3 })
    expect(await counts(manager, month("2026-09-30"))).toEqual({ interviewed: 6, passed: 3, failed: 3 })
    expect(await counts(manager, month("2026-10-01"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
    expect(await counts(manager, month("2026-08-01"))).toEqual({ interviewed: 0, passed: 0, failed: 0 })
  })

  test("Year is the calendar year", async () => {
    const manager = await signedIn(MANAGER)
    // 31 December 2025 ends 2025; 1 January 2026 starts 2026.
    expect(await counts(manager, year("2025-12-31"))).toEqual({ interviewed: 11, passed: 10, failed: 1 })
    expect(await counts(manager, year("2026-01-01"))).toEqual({ interviewed: 10, passed: 6, failed: 5 })
    expect(await counts(manager, year("2024-06-15"))).toEqual({ interviewed: 0, passed: 0, failed: 0 })
  })

  test("a retake in the same period counts the child once and each sitting once", async () => {
    // ADMSN-31015 failed on 10 June 2026 and passed a retake on 24 June.
    const manager = await signedIn(MANAGER)
    expect(await counts(manager, month("2026-06-01"))).toEqual({ interviewed: 1, passed: 1, failed: 1 })
    expect(await counts(manager, week("2026-06-08"))).toEqual({ interviewed: 1, passed: 0, failed: 1 })
    expect(await counts(manager, week("2026-06-22"))).toEqual({ interviewed: 1, passed: 1, failed: 0 })
  })

  test("a registered interview with no result is counted nowhere", async () => {
    // ADMSN-31010, registered on 29 September 2026 with no result yet.
    const pending = await asSystem(async (sql) =>
      (
        await sql.query<{ result: string | null; interview_date: string | null }>(
          "select result, interview_date from public.interviews where id = '1e7e2031-0000-4000-8000-000000000012'",
        )
      ).rows,
    )
    expect(pending).toEqual([{ result: null, interview_date: null }])

    const manager = await signedIn(MANAGER)
    expect(await counts(manager, date("2026-09-29"))).toEqual({ interviewed: 0, passed: 0, failed: 0 })
    const registered = await asSystem(async (sql) =>
      Number((await sql.query<{ count: string }>("select count(*) from public.interviews where serial_year = $1", [YEAR])).rows[0].count),
    )
    const all = await counts(manager, ALL)
    expect(all.passed + all.failed).toBe(registered - 1)
  })

  test("Paid and Not Paid interviews count alike", async () => {
    const fees = await asSystem(async (sql) =>
      Object.fromEntries(
        (
          await sql.query<{ interview_date: string; result: string; fee_status: string }>(
            `select to_char(interview_date, 'YYYY-MM-DD') as interview_date, result, fee_status
               from public.interviews where serial_year = $1 and interview_date in ('2026-09-27', '2026-09-28')`,
            [YEAR],
          )
        ).rows.map((row) => [`${row.interview_date} ${row.result}`, row.fee_status]),
      ),
    )
    expect(fees).toEqual({
      "2026-09-27 Passed": "Not Paid",
      "2026-09-27 Failed": "Paid",
      "2026-09-28 Passed": "Paid",
      "2026-09-28 Failed": "Not Paid",
    })

    const manager = await signedIn(MANAGER)
    expect(await counts(manager, date("2026-09-27"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
    expect(await counts(manager, date("2026-09-28"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
  })

  test("a Declined, Inactive or Archived lead's interview still counts", async () => {
    const manager = await signedIn(MANAGER)
    // ADMSN-31007, Declined, failed on 30 September; ADMSN-31008, Inactive,
    // passed the same day.
    expect(await counts(manager, date("2026-09-30"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
    // ADMSN-31009, Archived, passed on 1 October, beside ADMSN-31016's fail.
    expect(await counts(manager, date("2026-10-01"))).toEqual({ interviewed: 2, passed: 1, failed: 1 })
  })

  test("every role that may view leads sees the same counts", async () => {
    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT]) {
      const supabase = await signedIn(person)
      expect(await counts(supabase, ALL)).toEqual({ interviewed: 21, passed: 16, failed: 6 })
      expect(await counts(supabase, week("2026-09-28"))).toEqual({ interviewed: 6, passed: 3, failed: 3 })
    }
  })

  test("the Enrollment year combines with each period: the unfiltered count is the sum over every year", async () => {
    const manager = await signedIn(MANAGER)
    const periods: Period[] = [ALL, date("2026-09-28"), week("2026-09-28"), month("2026-09-01"), year("2026-01-01")]

    // No lead or interview may be written meanwhile, so counts taken one after
    // another agree.
    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, ["public.leads", "public.interviews"])
      const years = await listEnrollmentYears(manager)
      if (!years.ok) throw new Error(years.error)
      for (const period of periods) {
        const sums: Counts = { interviewed: 0, passed: 0, failed: 0 }
        for (const each of years.data) {
          const one = await counts(manager, period, each)
          sums.interviewed += one.interviewed
          sums.passed += one.passed
          sums.failed += one.failed
        }
        expect(await counts(manager, period, null), JSON.stringify(period)).toEqual(sums)
      }
    })
  })
})

describe("corrections move the counts", () => {
  test("a corrected result or interview date moves the interview, and the lead's current Enrollment year decides its intake", async () => {
    // A lead of the test's own in a year claimed for the test, so no fixture
    // is touched. The years keep earlier runs' interviews, so the test
    // compares counts before and after each change rather than totals.
    const home = await claimInterviewYear()
    let moved: InterviewYearClaim | undefined
    try {
      const other = await claimInterviewYear()
      moved = other
      const staff = await signedIn(ADMISSIONS)
      const created = await createLead(staff, {
        guardian: {
          // A leading 6 keeps it clear of the seeded 700 000 numbers.
          contact: { fullName: "Count Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
        },
        student: {
          fullName: `Counted ${randomUUID().slice(0, 8)}`,
          className: "STD 4",
          enrollmentYear: Number(tanzaniaToday().slice(0, 4)) + 1,
          dayOrBoarding: "Day",
        },
        start: { kind: "walk-in", visitDate: "2026-03-02" },
      })
      if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
      const lead = created.data.leadId

      // Registered on the day of the visit, numbered on from the year's
      // counter as register_for_interview would.
      const interview = await asSystem(async (sql) => {
        await sql.query("update public.leads set enrollment_year = $2 where id = $1", [lead, home.year])
        const counter = await sql.query<{ last_number: number }>(
          `insert into public.interview_serial_counters (enrollment_year, last_number) values ($1, 1)
           on conflict (enrollment_year) do update set last_number = public.interview_serial_counters.last_number + 1
           returning last_number`,
          [home.year],
        )
        const inserted = await sql.query<{ id: string }>(
          `insert into public.interviews (lead, serial_number, serial_year, registered_at, registered_by)
           values ($1, $2, $3, '2026-03-02 10:00+03', $4) returning id`,
          [lead, counter.rows[0].last_number, home.year, ADMISSIONS.id],
        )
        return inserted.rows[0].id
      })

      const first = date("2026-03-04")
      const later = date("2026-03-11")
      const march = month("2026-03-01")
      const before = {
        first: await counts(staff, first, home.year),
        later: await counts(staff, later, home.year),
        march: await counts(staff, march, home.year),
        all: await counts(staff, ALL, home.year),
        movedLater: await counts(staff, later, other.year),
      }
      const plus = (base: Counts, change: Partial<Counts>): Counts => ({
        interviewed: base.interviewed + (change.interviewed ?? 0),
        passed: base.passed + (change.passed ?? 0),
        failed: base.failed + (change.failed ?? 0),
      })

      // Recorded as Passed on 4 March.
      expect((await recordInterviewResult(staff, interview, { interviewDate: "2026-03-04", result: "Passed", score: 70 })).ok).toBe(true)
      expect(await counts(staff, first, home.year)).toEqual(plus(before.first, { interviewed: 1, passed: 1 }))

      // Corrected to Failed: the sitting moves from Passed to Failed.
      expect((await recordInterviewResult(staff, interview, { interviewDate: "2026-03-04", result: "Failed", score: 40 })).ok).toBe(true)
      expect(await counts(staff, first, home.year)).toEqual(plus(before.first, { interviewed: 1, failed: 1 }))

      // Corrected to 11 March: it leaves the 4th for the 11th, and stays in March.
      expect((await recordInterviewResult(staff, interview, { interviewDate: "2026-03-11", result: "Failed", score: 40 })).ok).toBe(true)
      expect(await counts(staff, first, home.year)).toEqual(before.first)
      expect(await counts(staff, later, home.year)).toEqual(plus(before.later, { interviewed: 1, failed: 1 }))
      expect(await counts(staff, march, home.year)).toEqual(plus(before.march, { interviewed: 1, failed: 1 }))

      // The lead's Enrollment year corrected: the interview follows the lead,
      // although its S/N stays in the year it was issued in.
      await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [lead, other.year]))
      const serialYear = await asSystem(
        async (sql) => (await sql.query<{ serial_year: number }>("select serial_year from public.interviews where id = $1", [interview])).rows[0].serial_year,
      )
      expect(serialYear).toBe(home.year)
      expect(await counts(staff, later, home.year)).toEqual(before.later)
      expect(await counts(staff, ALL, home.year)).toEqual(before.all)
      expect(await counts(staff, later, other.year)).toEqual(plus(before.movedLater, { interviewed: 1, failed: 1 }))
    } finally {
      await home.release()
      await moved?.release()
    }
  })
})

describe("who may read the interview counts", () => {
  const metrics: DashboardMetric[] = ["interviewed_leads", "passed_interviews", "failed_interviews"]

  test("a role without leads.view is refused, not shown zero", async () => {
    const supabase = await signedIn(await createThrowawayStaff(["payments.view"]))
    for (const metric of metrics) {
      expect(await getMetricCount(supabase, metric, { period: ALL, enrollmentYear: null })).toEqual({ ok: false, error: "forbidden" })
    }
  })

  test("a visitor who is not signed in cannot call the function", async () => {
    const anon = anonClient()
    for (const metric of metrics) {
      const result = await anon.rpc("dashboard_count", { metric, period_kind: "all", anchor: null, enrollment_year: null })
      expect(result.error?.code).toBe("42501")
      expect(await getMetricCount(anon, metric, { period: ALL, enrollmentYear: null })).toEqual({ ok: false, error: "forbidden" })
    }
  })

  test("reading the counts writes nothing to the audit history", async () => {
    const reader = await createThrowawayStaff(["leads.view"])
    expect(await counts(await signedIn(reader), ALL)).toEqual({ interviewed: 21, passed: 16, failed: 6 })

    const rows = await asSystem(async (sql) =>
      (await sql.query("select 1 from public.audit_log where actor_staff_id = $1", [reader.id])).rowCount,
    )
    expect(rows).toBe(0)
  })
})
