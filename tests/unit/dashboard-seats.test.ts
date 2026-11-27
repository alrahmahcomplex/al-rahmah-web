import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

import { getSeatFiguresByClass, getSeatsByClass } from "@/lib/services/dashboard"

// The permission check comes first: a staff member without payments.view is
// refused without the streams or the Fee schedules being read at all.

function client(hasPaymentsView: boolean, scheduleYears: number[] = []) {
  const rpc = vi.fn(async (name: string, args?: { schedule_year?: number }) =>
    name === "has_permission"
      ? { data: hasPaymentsView, error: null }
      : name === "year_seat_figures"
        ? { data: { classes: [] }, error: null }
        : name === "year_streams"
          ? { data: { enrollment_year: args?.schedule_year ?? 2027, classes: [], requests: [] }, error: null }
          : { data: [], error: null },
  )
  const rows = scheduleYears.map((enrollment_year) => ({
    enrollment_year,
    first_share: 40,
    second_share: 40,
    third_share: 20,
    first_due: `${enrollment_year}-01-01`,
    second_due: `${enrollment_year}-04-01`,
    third_due: `${enrollment_year}-06-01`,
    minimum_deposit: 1,
    pre_form_one_day_fee: 1,
    pre_form_one_boarding_fee: 1,
    academic_year_start: null,
    fee_band_amounts: [],
  }))
  const from = vi.fn(() => ({
    select: () => ({ order: async () => ({ data: rows, error: null }) }),
  }))
  return { rpc, from, supabase: { rpc, from } as unknown as SupabaseClient }
}

describe("getSeatsByClass and getSeatFiguresByClass", () => {
  test("without payments.view they return forbidden and read no seat", async () => {
    for (const read of [getSeatsByClass, getSeatFiguresByClass]) {
      const { rpc, from, supabase } = client(false)
      expect(await read(supabase, 2031)).toEqual({ ok: false, error: "forbidden" })
      expect(rpc).toHaveBeenCalledTimes(1)
      expect(rpc).toHaveBeenCalledWith("has_permission", { permission: "payments.view" })
      expect(from).not.toHaveBeenCalled()
    }
  })

  test("with no Fee schedule they show no year and ask for no seats", async () => {
    const home = client(true)
    expect(await getSeatsByClass(home.supabase)).toEqual({ ok: true, data: { year: null, years: [], streams: null, figures: null } })
    expect(home.rpc).toHaveBeenCalledTimes(1)
    const reports = client(true)
    expect(await getSeatFiguresByClass(reports.supabase)).toEqual({ ok: true, data: { year: null, years: [], classes: [] } })
    expect(reports.rpc).toHaveBeenCalledTimes(1)
  })

  test("without a requested year they open on the current admission year's default seats year", async () => {
    const schedules = [2026, 2027, 2031]
    for (const [today, expected] of [
      ["2026-05-31", 2026],
      ["2026-06-01", 2027],
      ["2026-12-31", 2027],
      ["2027-01-01", 2027],
    ] as const) {
      const home = client(true, schedules)
      const homeRes = await getSeatsByClass(home.supabase, null, today)
      expect(homeRes.ok && homeRes.data.year).toBe(expected)

      const reports = client(true, schedules)
      const reportsRes = await getSeatFiguresByClass(reports.supabase, null, today)
      expect(reportsRes.ok && reportsRes.data.year).toBe(expected)
    }
  })
})
