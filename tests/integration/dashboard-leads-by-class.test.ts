import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test } from "vitest"

import { getLeadsByClass, listEnrollmentYears, type LeadsByClass, type Period } from "@/lib/services/dashboard"
import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead, LEAD_CLASSES, updateLeadDetails } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, lockExclusively, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Leads by enrollment class against local Supabase. Counts are filtered to
// Enrollment year 2031, the dashboard's own fixtures in
// supabase/seeds/95_dashboard.sql, so no other test's leads shift them.

const YEAR = 2031
const thisYear = Number(tanzaniaToday().slice(0, 4))
// A year a correction may move a lead into (this year or the next two) that
// isn't the fixtures' year, whenever the test runs.
const otherYear = [thisYear + 1, thisYear + 2, thisYear].find((year) => year !== YEAR)!

async function byClass(supabase: SupabaseClient, period: Period, enrollmentYear: number | null = YEAR): Promise<LeadsByClass> {
  const result = await getLeadsByClass(supabase, { period, enrollmentYear })
  if (!result.ok) throw new Error(`count refused: ${result.error}`)
  return result.data
}

// Only the classes with leads, for a short expectation.
function nonZero(counts: LeadsByClass): Record<string, number> {
  return Object.fromEntries(counts.classes.filter((row) => row.count > 0).map((row) => [row.className, row.count]))
}

const date = (anchor: string): Period => ({ kind: "date", anchor })
const week = (anchor: string): Period => ({ kind: "week", anchor })
const month = (anchor: string): Period => ({ kind: "month", anchor })
const year = (anchor: string): Period => ({ kind: "year", anchor })

describe("Leads by enrollment class", () => {
  test("lists every class in school order, zeros included, with the total", async () => {
    const counts = await byClass(await signedIn(MANAGER), { kind: "all" })

    expect(counts.classes.map((row) => row.className)).toEqual([...LEAD_CLASSES])
    expect(counts.classes.map((row) => row.count)).toEqual([
      1, // DAY CARE
      2, // KG 1
      1, // KG 2
      3, // STD 1
      5, // STD 2
      5, // STD 3
      4, // STD 4
      2, // STD 5
      1, // STD 6
      0, // STD 7
      2, // FORM 1
      1, // FORM 2
      0, // FORM 3
      0, // FORM 4
    ])
    expect(counts.total).toBe(27)
  })

  test("the database lists the class enum in its declared order, so the module's class list matches it", async () => {
    const { data, error } = await (await signedIn(MANAGER)).rpc("dashboard_leads_by_class", {
      period_kind: "all",
      anchor: null,
      enrollment_year: YEAR,
    })
    expect(error).toBeNull()
    expect((data as { class_name: string }[]).map((row) => row.class_name)).toEqual([...LEAD_CLASSES])
  })

  test("counts every lead whatever its status or closure mark", async () => {
    const manager = await signedIn(MANAGER)
    expect(nonZero(await byClass(manager, date("2026-09-22")))).toEqual({ "STD 2": 1 }) // Declined
    expect(nonZero(await byClass(manager, date("2026-09-23")))).toEqual({ "KG 2": 1 }) // Inactive
    expect(nonZero(await byClass(manager, date("2026-09-24")))).toEqual({ "FORM 2": 1 }) // Archived
    expect(nonZero(await byClass(manager, date("2026-09-10")))).toEqual({ "STD 4": 1 }) // Applied, no visit
  })

  test("a lead created at 00:30 on a Monday in Tanzania counts on the Monday", async () => {
    // ADMSN-31013: 00:30 on Monday 28 September, 21:30 on the Sunday in UTC.
    const manager = await signedIn(MANAGER)
    expect((await byClass(manager, date("2026-09-28"))).total).toBe(1)
    // ADMSN-31012, at 23:30 on the Sunday, stays on the Sunday.
    expect((await byClass(manager, date("2026-09-27"))).total).toBe(1)
    expect((await byClass(manager, week("2026-09-28"))).total).toBe(1)
  })

  test("Date counts one day", async () => {
    const manager = await signedIn(MANAGER)
    expect(nonZero(await byClass(manager, date("2026-09-20")))).toEqual({ "STD 1": 1 })
    expect(nonZero(await byClass(manager, date("2026-09-21")))).toEqual({ "KG 1": 1 })
    expect((await byClass(manager, date("2026-09-19"))).total).toBe(0)
  })

  test("Week runs Monday to Sunday, whichever day anchors it", async () => {
    const manager = await signedIn(MANAGER)
    // Sunday 20 September ends the week of 14 September.
    expect((await byClass(manager, week("2026-09-14"))).total).toBe(1)
    expect((await byClass(manager, week("2026-09-20"))).total).toBe(1)
    // Monday 21 September starts the next, through 23:30 on Sunday the 27th.
    const next = await byClass(manager, week("2026-09-21"))
    expect(nonZero(next)).toEqual({ "KG 1": 1, "KG 2": 1, "STD 1": 1, "STD 2": 1, "FORM 2": 1 })
    expect(next.total).toBe(5)
    expect((await byClass(manager, week("2026-09-27"))).total).toBe(5)
    // A week across a month end and one across a year end.
    expect(nonZero(await byClass(manager, week("2026-09-02")))).toEqual({ "STD 3": 1, "FORM 1": 1 })
    expect(nonZero(await byClass(manager, week("2026-01-01")))).toEqual({ "DAY CARE": 1, "STD 5": 1 })
  })

  test("Month is the calendar month", async () => {
    const manager = await signedIn(MANAGER)
    expect(nonZero(await byClass(manager, month("2026-08-31")))).toEqual({ "STD 3": 1 })
    expect((await byClass(manager, month("2026-09-01"))).total).toBe(9)
    expect((await byClass(manager, month("2026-09-30"))).total).toBe(9)
  })

  test("Year is the calendar year", async () => {
    const manager = await signedIn(MANAGER)
    // The 2025 leads: ADMSN-31005 on the last day of the year, the retaken
    // ADMSN-31027 in October, and the ten Enrolled students fixtures created
    // in November.
    expect(nonZero(await byClass(manager, year("2025-12-31")))).toEqual({ "DAY CARE": 1, "STD 2": 4, "STD 3": 3, "STD 4": 3, "STD 5": 1 })
    expect((await byClass(manager, year("2026-01-01"))).total).toBe(15)
    expect((await byClass(manager, year("2024-06-15"))).total).toBe(0)
  })

  test("every role that may view leads sees the same counts", async () => {
    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT]) {
      const supabase = await signedIn(person)
      expect((await byClass(supabase, { kind: "all" })).total).toBe(27)
      expect((await byClass(supabase, week("2026-09-21"))).total).toBe(5)
    }
  })

  test("a corrected class or Enrollment year moves the lead", async () => {
    // A lead of the test's own, from the Admission form so it has no visit and
    // the Visited leads tests never see it, created in May 2026, a month no
    // fixture uses. It leaves 2031 at the end and stays out of it, so no
    // fixture is touched and no run's leftovers reach the 2031 counts.
    const staff = await signedIn(ADMISSIONS)
    const may = month("2026-05-01")
    expect((await byClass(staff, may)).total).toBe(0)
    const created = await createLead(secretClient(), {
      guardian: {
        contact: { fullName: "Class Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
      },
      student: { fullName: `Class Pupil ${randomUUID().slice(0, 8)}`, className: "FORM 1", enrollmentYear: otherYear, dayOrBoarding: "Day" },
      start: { kind: "admission-form" },
    })
    if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
    const lead = created.data.leadId
    await asSystem((sql) =>
      sql.query("update public.leads set enrollment_year = $2, created_at = '2026-05-12T06:00:00Z' where id = $1", [lead, YEAR]),
    )
    try {
      expect(nonZero(await byClass(staff, may))).toEqual({ "FORM 1": 1 })

      expect((await updateLeadDetails(staff, lead, { className: "FORM 3" })).ok).toBe(true)
      expect(nonZero(await byClass(staff, may))).toEqual({ "FORM 3": 1 })

      // Out of 2031, into a year a correction allows.
      const before = (await byClass(staff, may, otherYear)).classes.find((row) => row.className === "FORM 3")!.count
      expect((await updateLeadDetails(staff, lead, { enrollmentYear: otherYear })).ok).toBe(true)
      expect((await byClass(staff, may)).total).toBe(0)
      expect((await byClass(staff, may, otherYear)).classes.find((row) => row.className === "FORM 3")!.count).toBe(before + 1)
    } finally {
      // A failed run must not leave its lead in 2031 for the next one to count.
      await asSystem((sql) =>
        sql.query("update public.leads set enrollment_year = $2 where id = $1 and enrollment_year = $3", [lead, otherYear, YEAR]),
      )
    }
  })

  test("the Enrollment year combines with each period: the unfiltered count is the sum over every year", async () => {
    const manager = await signedIn(MANAGER)
    const periods: Period[] = [{ kind: "all" }, date("2026-09-01"), week("2026-08-31"), month("2026-09-01"), year("2026-01-01")]

    // No lead may be written meanwhile, so counts taken one after another agree.
    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, ["public.leads"])
      const years = await listEnrollmentYears(manager)
      if (!years.ok) throw new Error(years.error)
      for (const period of periods) {
        const unfiltered = await byClass(manager, period, null)
        const sums = LEAD_CLASSES.map(() => 0)
        for (const each of years.data) {
          ;(await byClass(manager, period, each)).classes.forEach((row, i) => (sums[i] += row.count))
        }
        expect(unfiltered.classes.map((row) => row.count), JSON.stringify(period)).toEqual(sums)
        expect(unfiltered.total).toBe(sums.reduce((a, b) => a + b, 0))
      }
    })
  })

  test("an unknown period or a malformed anchor is refused as invalid", async () => {
    const manager = await signedIn(MANAGER)
    expect(await getLeadsByClass(manager, { period: { kind: "fortnight" as "week", anchor: "2026-09-21" }, enrollmentYear: null })).toEqual({
      ok: false,
      error: "invalid",
    })
    expect(await getLeadsByClass(manager, { period: { kind: "week", anchor: "not-a-date" }, enrollmentYear: null })).toEqual({
      ok: false,
      error: "invalid",
    })
  })
})

describe("who may read Leads by enrollment class", () => {
  test("a role without leads.view is refused, not shown zeros", async () => {
    const supabase = await signedIn(await createThrowawayStaff(["payments.view"]))
    expect(await getLeadsByClass(supabase, { period: { kind: "all" }, enrollmentYear: null })).toEqual({
      ok: false,
      error: "forbidden",
    })
  })

  test("a visitor who is not signed in cannot call the function", async () => {
    const anon = anonClient()
    const rows = await anon.rpc("dashboard_leads_by_class", { period_kind: "all", anchor: null, enrollment_year: null })
    expect(rows.error?.code).toBe("42501")
    expect(await getLeadsByClass(anon, { period: { kind: "all" }, enrollmentYear: null })).toEqual({ ok: false, error: "forbidden" })
  })

  test("reading it writes nothing to the audit history", async () => {
    const reader = await createThrowawayStaff(["leads.view"])
    expect((await byClass(await signedIn(reader), { kind: "all" })).total).toBe(27)

    const rows = await asSystem(async (sql) =>
      (await sql.query("select 1 from public.audit_log where actor_staff_id = $1", [reader.id])).rowCount,
    )
    expect(rows).toBe(0)
  })
})
