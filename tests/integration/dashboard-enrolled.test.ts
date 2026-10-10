import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import type { Client } from "pg"
import { describe, expect, test } from "vitest"

import { getMetricCount, listEnrollmentYears, type Period } from "@/lib/services/dashboard"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, lockExclusively, signedIn, withoutLockWaits } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Enrolled students against local Supabase. Counts are filtered to Enrollment
// year 2031, the dashboard's own fixtures in supabase/seeds/95_dashboard.sql,
// whose header lists the ten Enrolled students leads (ADMSN-31017 to
// ADMSN-31026). Seven of them count: one on each of 2025-12-31, 2026-01-01,
// 2026-05-31, 2026-06-01, 2026-08-11, 2026-08-14 and 2031-01-08.

const YEAR = 2031

const lead = (n: number) => `1ead2031-0000-4000-8000-0000000000${n}`

async function enrolled(supabase: SupabaseClient, period: Period, enrollmentYear: number | null = YEAR): Promise<number> {
  const count = await getMetricCount(supabase, "enrolled_students", { period, enrollmentYear })
  if (!count.ok) throw new Error(`count refused: ${count.error}`)
  return count.data
}

const ALL: Period = { kind: "all" }
const date = (anchor: string): Period => ({ kind: "date", anchor })
const week = (anchor: string): Period => ({ kind: "week", anchor })
const month = (anchor: string): Period => ({ kind: "month", anchor })
const year = (anchor: string): Period => ({ kind: "year", anchor })

// Acts inside `sql`'s transaction as a seeded staff member's signed-in
// session, the way the API would, until `asOwner`.
async function asStaff(sql: Client, staffId: string) {
  const { rows } = await sql.query("select user_id from public.staff_members where id = $1", [staffId])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  await sql.query("set local role authenticated")
}

async function asOwner(sql: Client) {
  await sql.query("reset role")
  await sql.query("select set_config('request.jwt.claims', '', true)")
}

// The count the dashboard reads, from inside `sql`'s transaction, as Test
// Manager: what the module would show if the transaction committed.
async function enrolledWithin(sql: Client, period: Period): Promise<number> {
  await asStaff(sql, MANAGER.id)
  try {
    const { rows } = await sql.query<{ count: string }>("select public.dashboard_count('enrolled_students', $1, $2, $3) as count", [
      period.kind,
      period.kind === "all" ? null : period.anchor,
      YEAR,
    ])
    return Number(rows[0].count)
  } finally {
    await asOwner(sql)
  }
}

describe("Enrolled students", () => {
  test("All time counts the leads Enrolled now, and leaves out the reverted, Declined and waiting leads", async () => {
    const statuses = await asSystem(
      async (sql) =>
        (
          await sql.query<{ admission_number: string; status: string; closure: string | null }>(
            `select admission_number, status, closure from public.leads
             where admission_number between 'ADMSN-31017' and 'ADMSN-31026' order by admission_number`,
          )
        ).rows,
    )
    expect(statuses.filter((row) => row.status === "Enrolled").map((row) => row.admission_number)).toEqual([
      "ADMSN-31017",
      "ADMSN-31018",
      "ADMSN-31019",
      "ADMSN-31020",
      "ADMSN-31021",
      "ADMSN-31022",
      "ADMSN-31025",
    ])

    expect(await enrolled(await signedIn(MANAGER), ALL)).toBe(7)
  })

  test("Date counts one day", async () => {
    const manager = await signedIn(MANAGER)
    expect(await enrolled(manager, date("2026-05-31"))).toBe(1)
    expect(await enrolled(manager, date("2026-06-01"))).toBe(1)
    expect(await enrolled(manager, date("2026-05-30"))).toBe(0)
  })

  test("Week runs Monday to Sunday, whichever day anchors it", async () => {
    const manager = await signedIn(MANAGER)
    // Sunday 31 May ends the week of 25 May; Monday 1 June starts the next.
    expect(await enrolled(manager, week("2026-05-25"))).toBe(1)
    expect(await enrolled(manager, week("2026-05-31"))).toBe(1)
    expect(await enrolled(manager, week("2026-06-01"))).toBe(1)
    expect(await enrolled(manager, week("2026-06-07"))).toBe(1)
    // The week from Monday 29 December 2025 runs across the year end.
    expect(await enrolled(manager, week("2025-12-31"))).toBe(2)
  })

  test("Month is the calendar month", async () => {
    const manager = await signedIn(MANAGER)
    expect(await enrolled(manager, month("2026-05-01"))).toBe(1)
    expect(await enrolled(manager, month("2026-05-31"))).toBe(1)
    expect(await enrolled(manager, month("2026-06-01"))).toBe(1)
    expect(await enrolled(manager, month("2026-07-01"))).toBe(0)
  })

  test("Year is the calendar year", async () => {
    const manager = await signedIn(MANAGER)
    // 31 December 2025 ends 2025; 1 January 2026 starts 2026.
    expect(await enrolled(manager, year("2025-12-31"))).toBe(1)
    expect(await enrolled(manager, year("2026-01-01"))).toBe(5)
    expect(await enrolled(manager, year("2031-06-30"))).toBe(1)
    expect(await enrolled(manager, year("2024-06-15"))).toBe(0)
  })

  test("a lead enrolled on the Academic-year start counts on the start date", async () => {
    // ADMSN-31021 reached First instalment on 6 July 2026; the 2031 start is
    // Wednesday 8 January 2031.
    const manager = await signedIn(MANAGER)
    expect(await enrolled(manager, date("2031-01-08"))).toBe(1)
    expect(await enrolled(manager, date("2031-01-07"))).toBe(0)
    expect(await enrolled(manager, date("2026-07-06"))).toBe(0)
  })

  test("enrol_from_academic_year_start enrols a waiting First instalment lead on the start date", async () => {
    // ADMSN-31026 reached First instalment on 8 July 2026 and waits for the
    // start. The sweep reaches every year, so it runs in a transaction that
    // is rolled back.
    await inRolledBackTransaction(async (sql) => {
      expect(await enrolledWithin(sql, date("2031-01-08"))).toBe(1)
      expect(await enrolledWithin(sql, ALL)).toBe(7)

      await sql.query("select public.set_audit_actor('system')")
      await withoutLockWaits(sql, "select public.enrol_from_academic_year_start('2031-01-08')")
      const { rows } = await sql.query<{ status: string; enrolled_on: string }>(
        `select l.status, p.enrolled_on::text from public.leads l join public.lead_fee_profiles p on p.lead_id = l.id where l.id = $1`,
        [lead(26)],
      )
      expect(rows).toEqual([{ status: "Enrolled", enrolled_on: "2031-01-08" }])

      expect(await enrolledWithin(sql, date("2031-01-08"))).toBe(2)
      expect(await enrolledWithin(sql, date("2026-07-08"))).toBe(0)
      expect(await enrolledWithin(sql, ALL)).toBe(8)
    })
  })

  test("a lead paid in full after reaching First instalment counts on the date it reached Full", async () => {
    // ADMSN-31022 reached First instalment on 7 July 2026 and Full on
    // 11 August, before the start.
    const manager = await signedIn(MANAGER)
    expect(await enrolled(manager, date("2026-08-11"))).toBe(1)
    expect(await enrolled(manager, date("2026-07-07"))).toBe(0)
    expect(await enrolled(manager, date("2031-01-08"))).toBe(1)
  })

  test("the reverted and Declined leads are left out, and the Archived one counts", async () => {
    const manager = await signedIn(MANAGER)
    // ADMSN-31023, Full on 12 August and then adjusted to a deposit.
    expect(await enrolled(manager, date("2026-08-12"))).toBe(0)
    // ADMSN-31024, Full on 13 August and then Declined.
    expect(await enrolled(manager, date("2026-08-13"))).toBe(0)
    // ADMSN-31025, Full on 14 August and then Archived.
    expect(await enrolled(manager, date("2026-08-14"))).toBe(1)
    expect(await enrolled(manager, month("2026-08-01"))).toBe(2)
  })

  test("an adjustment that moves the trigger date moves the count", async () => {
    // ADMSN-31019's Full payment, recorded on Sunday 31 May, moved to Monday
    // 1 June by Test Accountant. Rolled back afterwards.
    await inRolledBackTransaction(async (sql) => {
      const payment = (
        await sql.query<{ id: string }>("select id from public.school_fee_payments where lead_id = $1", [lead(19)])
      ).rows[0].id
      expect(await enrolledWithin(sql, date("2026-05-31"))).toBe(1)
      expect(await enrolledWithin(sql, date("2026-06-01"))).toBe(1)

      await asStaff(sql, ACCOUNTANT.id)
      await sql.query("select public.adjust_school_fee_payment($1, 'Wrong payment date', false, 'full_payment', 2000000, '2026-06-01', null, $2)", [
        payment,
        randomUUID(),
      ])
      await asOwner(sql)

      expect(await enrolledWithin(sql, date("2026-05-31"))).toBe(0)
      expect(await enrolledWithin(sql, date("2026-06-01"))).toBe(2)
      expect(await enrolledWithin(sql, week("2026-05-25"))).toBe(0)
      expect(await enrolledWithin(sql, month("2026-05-01"))).toBe(0)
      expect(await enrolledWithin(sql, month("2026-06-01"))).toBe(2)
      expect(await enrolledWithin(sql, ALL)).toBe(7)
    })
  })

  test("every role that may view leads sees the same counts", async () => {
    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT]) {
      const supabase = await signedIn(person)
      expect(await enrolled(supabase, ALL)).toBe(7)
      expect(await enrolled(supabase, month("2026-08-01"))).toBe(2)
    }
  })

  test("the Enrollment year combines with each period: the unfiltered count is the sum over every year", async () => {
    const manager = await signedIn(MANAGER)
    const periods: Period[] = [ALL, date("2026-09-25"), week("2026-09-21"), month("2026-08-01"), year("2026-01-01")]

    // No lead or lead fee profile may be written meanwhile, so counts taken
    // one after another agree.
    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, ["public.leads", "public.lead_fee_profiles"])
      const years = await listEnrollmentYears(manager)
      if (!years.ok) throw new Error(years.error)
      for (const period of periods) {
        let sum = 0
        for (const each of years.data) sum += await enrolled(manager, period, each)
        expect(await enrolled(manager, period, null), JSON.stringify(period)).toBe(sum)
      }
    })

    // The base fixtures' 2027 students enrolled in late September 2026; the
    // 2031 ones on other days.
    expect(await enrolled(manager, week("2026-09-21"), 2027)).toBeGreaterThan(0)
    expect(await enrolled(manager, week("2026-09-21"))).toBe(0)
    expect(await enrolled(manager, date("2026-05-31"), 2027)).toBe(0)
    expect(await enrolled(manager, date("2026-05-31"))).toBe(1)
  })
})

describe("who may read Enrolled students", () => {
  test("a role without leads.view is refused, not shown zero", async () => {
    const supabase = await signedIn(await createThrowawayStaff(["payments.view"]))
    expect(await getMetricCount(supabase, "enrolled_students", { period: ALL, enrollmentYear: null })).toEqual({ ok: false, error: "forbidden" })
  })

  test("a visitor who is not signed in cannot call the function", async () => {
    const anon = anonClient()
    const result = await anon.rpc("dashboard_count", { metric: "enrolled_students", period_kind: "all", anchor: null, enrollment_year: null })
    expect(result.error?.code).toBe("42501")
    expect(await getMetricCount(anon, "enrolled_students", { period: ALL, enrollmentYear: null })).toEqual({ ok: false, error: "forbidden" })
  })

  test("reading the count writes nothing to the audit history", async () => {
    const reader = await createThrowawayStaff(["leads.view"])
    expect(await enrolled(await signedIn(reader), ALL)).toBe(7)

    const rows = await asSystem(async (sql) => (await sql.query("select 1 from public.audit_log where actor_staff_id = $1", [reader.id])).rowCount)
    expect(rows).toBe(0)
  })
})
