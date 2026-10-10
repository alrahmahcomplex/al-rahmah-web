import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test } from "vitest"

import { correctVisitDate } from "@/lib/services/leads"
import {
  getMetricCount,
  listEnrollmentYears,
  type DashboardFilters,
  type Period,
} from "@/lib/services/dashboard"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, lockExclusively, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The dashboard module against local Supabase. Counts are filtered to
// Enrollment year 2031, the dashboard's own fixtures in
// supabase/seeds/95_dashboard.sql, so no other test's leads shift them.

const YEAR = 2031

async function visited(supabase: SupabaseClient, period: Period, enrollmentYear: number | null = YEAR): Promise<number> {
  const count = await getMetricCount(supabase, "visited_leads", { period, enrollmentYear })
  if (!count.ok) throw new Error(`count refused: ${count.error}`)
  return count.data
}

const date = (anchor: string): Period => ({ kind: "date", anchor })
const week = (anchor: string): Period => ({ kind: "week", anchor })
const month = (anchor: string): Period => ({ kind: "month", anchor })
const year = (anchor: string): Period => ({ kind: "year", anchor })

// Runs `work` while no lead can be written, so counts taken one after another
// agree with each other.
function withLeadsHeld<T>(work: () => Promise<T>): Promise<T> {
  return inRolledBackTransaction(async (sql) => {
    await lockExclusively(sql, ["public.leads"])
    return work()
  })
}

describe("Visited leads", () => {
  test("counts every visited 2031 lead for All time, and leaves the Applied lead with no visit out", async () => {
    // Twenty-seven 2031 leads, twenty-three of them visited.
    expect(await visited(await signedIn(MANAGER), { kind: "all" })).toBe(23)
  })

  test("counts a lead whatever its status or closure mark now", async () => {
    const manager = await signedIn(MANAGER)
    expect(await visited(manager, date("2026-09-22"))).toBe(1) // Declined
    expect(await visited(manager, date("2026-09-23"))).toBe(1) // Inactive
    expect(await visited(manager, date("2026-09-24"))).toBe(1) // Archived
  })

  test("Date counts one day", async () => {
    const manager = await signedIn(MANAGER)
    expect(await visited(manager, date("2026-09-20"))).toBe(1)
    expect(await visited(manager, date("2026-09-21"))).toBe(1)
    expect(await visited(manager, date("2026-09-19"))).toBe(0)
  })

  test("Week runs Monday to Sunday, whichever day anchors it", async () => {
    const manager = await signedIn(MANAGER)
    // Sunday 20 September ends the week of 14 September.
    expect(await visited(manager, week("2026-09-14"))).toBe(1)
    expect(await visited(manager, week("2026-09-20"))).toBe(1)
    // Monday 21 September starts the next: with the Declined, Inactive and
    // Archived visits on the 22nd to the 24th.
    expect(await visited(manager, week("2026-09-21"))).toBe(4)
    expect(await visited(manager, week("2026-09-27"))).toBe(4)
    // A week across a month end and one across a year end.
    expect(await visited(manager, week("2026-09-02"))).toBe(2)
    expect(await visited(manager, week("2026-01-01"))).toBe(2)
  })

  test("Month is the calendar month", async () => {
    const manager = await signedIn(MANAGER)
    expect(await visited(manager, month("2026-08-01"))).toBe(1)
    expect(await visited(manager, month("2026-08-31"))).toBe(1)
    expect(await visited(manager, month("2026-09-01"))).toBe(6)
    expect(await visited(manager, month("2026-09-30"))).toBe(6)
  })

  test("Year is the calendar year", async () => {
    const manager = await signedIn(MANAGER)
    // ADMSN-31005 on the last day of 2025, the retaken ADMSN-31027 in
    // October, and the ten Enrolled students fixtures in November.
    expect(await visited(manager, year("2025-12-31"))).toBe(12)
    expect(await visited(manager, year("2026-01-01"))).toBe(11)
    expect(await visited(manager, year("2024-06-15"))).toBe(0)
  })

  test("every role that may view leads sees the same counts", async () => {
    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT]) {
      const supabase = await signedIn(person)
      expect(await visited(supabase, { kind: "all" })).toBe(23)
      expect(await visited(supabase, week("2026-09-21"))).toBe(4)
    }
  })

  test("a corrected Visit date moves the lead to the corrected period", async () => {
    // ADMSN-31011, visited 10 March 2026. Put back afterwards.
    const lead = "1ead2031-0000-4000-8000-000000000011"
    const staff = await signedIn(ADMISSIONS)
    expect(await visited(staff, date("2026-03-10"))).toBe(1)
    expect(await visited(staff, date("2026-03-17"))).toBe(0)

    expect((await correctVisitDate(staff, lead, "2026-03-17")).ok).toBe(true)
    try {
      expect(await visited(staff, date("2026-03-10"))).toBe(0)
      expect(await visited(staff, date("2026-03-17"))).toBe(1)
      expect(await visited(staff, month("2026-03-01"))).toBe(1)
    } finally {
      expect((await correctVisitDate(staff, lead, "2026-03-10")).ok).toBe(true)
    }
  })

  test("the Enrollment year combines with each period: the unfiltered count is the sum over every year", async () => {
    const manager = await signedIn(MANAGER)
    const periods: Period[] = [{ kind: "all" }, date("2026-09-01"), week("2026-08-31"), month("2026-09-01"), year("2026-01-01")]

    await withLeadsHeld(async () => {
      const years = await listEnrollmentYears(manager)
      if (!years.ok) throw new Error(years.error)
      for (const period of periods) {
        let sum = 0
        for (const each of years.data) sum += await visited(manager, period, each)
        expect(await visited(manager, period, null), JSON.stringify(period)).toBe(sum)
      }
    })

    // 2031 alone, against the base fixtures' 2027 visits in the same week.
    expect(await visited(manager, week("2026-08-31"))).toBe(2)
    expect(await visited(manager, week("2026-08-31"), null)).toBeGreaterThan(2)
  })

  test("an unknown metric or period is refused as invalid", async () => {
    const manager = await signedIn(MANAGER)
    const bad = (filters: DashboardFilters) => getMetricCount(manager, "visited_leads", filters)
    expect(await getMetricCount(manager, "fees_collected" as "visited_leads", { period: { kind: "all" }, enrollmentYear: null })).toEqual({
      ok: false,
      error: "invalid",
    })
    expect(await bad({ period: { kind: "fortnight" as "week", anchor: "2026-09-21" }, enrollmentYear: null })).toEqual({
      ok: false,
      error: "invalid",
    })
    expect(await bad({ period: { kind: "week", anchor: "not-a-date" }, enrollmentYear: null })).toEqual({ ok: false, error: "invalid" })
  })
})

describe("Enrollment years", () => {
  test("are the years leads carry, newest first", async () => {
    const years = await listEnrollmentYears(await signedIn(MANAGER))
    if (!years.ok) throw new Error(years.error)
    expect(years.data).toContain(YEAR)
    expect(years.data).toContain(2027)
    expect(years.data).toEqual([...years.data].sort((a, b) => b - a))
    expect(new Set(years.data).size).toBe(years.data.length)
  })
})

describe("who may read the dashboard", () => {
  test("a role without leads.view is refused, not shown zero", async () => {
    const outsider = await createThrowawayStaff(["payments.view"])
    const supabase = await signedIn(outsider)
    expect(await getMetricCount(supabase, "visited_leads", { period: { kind: "all" }, enrollmentYear: null })).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await listEnrollmentYears(supabase)).toEqual({ ok: false, error: "forbidden" })
  })

  test("a visitor who is not signed in cannot call the functions", async () => {
    const anon = anonClient()
    const count = await anon.rpc("dashboard_count", { metric: "visited_leads", period_kind: "all", anchor: null, enrollment_year: null })
    expect(count.error?.code).toBe("42501")
    const years = await anon.rpc("dashboard_enrollment_years")
    expect(years.error?.code).toBe("42501")
    expect(await getMetricCount(anon, "visited_leads", { period: { kind: "all" }, enrollmentYear: null })).toEqual({
      ok: false,
      error: "forbidden",
    })
  })

  test("reading the dashboard writes nothing to the audit history", async () => {
    const reader = await createThrowawayStaff(["leads.view"])
    const supabase = await signedIn(reader)
    expect(await visited(supabase, { kind: "all" })).toBe(23)
    expect((await listEnrollmentYears(supabase)).ok).toBe(true)

    const rows = await asSystem(async (sql) =>
      (await sql.query("select 1 from public.audit_log where actor_staff_id = $1", [reader.id])).rowCount,
    )
    expect(rows).toBe(0)
  })
})
