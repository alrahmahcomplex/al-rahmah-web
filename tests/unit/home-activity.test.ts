import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import type { ClassSeatFigures } from "@/lib/services/dashboard-seats"
import { activityWindow, fullClasses, getHomeActivity, type FullClass } from "@/lib/services/home-activity"

function seats(className: ClassSeatFigures["className"], dayOrBoarding: "Day" | "Boarding", set: number | null, taken: number): ClassSeatFigures {
  return {
    className,
    dayOrBoarding,
    seats: set,
    taken,
    full: taken,
    firstInstalment: 0,
    deposit: 0,
    left: set === null ? null : Math.max(0, set - taken),
    overBy: set !== null && taken > set ? taken - set : null,
  }
}

describe("fullClasses", () => {
  it("lists every class whose set seats are all taken, adding day and boarding", () => {
    expect(
      fullClasses([
        seats("STD 1", "Day", 30, 12),
        seats("STD 6", "Day", 30, 30),
        seats("STD 6", "Boarding", 5, 6),
        seats("FORM 1", "Day", 40, 40),
      ]),
    ).toEqual([
      { className: "STD 6", taken: 36, seats: 35 },
      { className: "FORM 1", taken: 40, seats: 40 },
    ])
  })

  it("never counts a class full while one of its seat kinds is not set", () => {
    expect(fullClasses([seats("KG 1", "Day", 20, 20), seats("KG 1", "Boarding", null, 3)])).toEqual([])
  })
})

describe("activityWindow", () => {
  it("puts the rows ahead on the first pages and offsets the database by them", () => {
    expect(activityWindow(1, 3)).toEqual({ aheadShown: { from: 0, to: 3 }, offset: 0, limit: 7, wanted: 7 })
    expect(activityWindow(2, 3)).toEqual({ aheadShown: { from: 3, to: 3 }, offset: 7, limit: 10, wanted: 10 })
  })

  it("still asks the database for one row, for the total, when the page is all rows ahead", () => {
    expect(activityWindow(1, 12)).toEqual({ aheadShown: { from: 0, to: 10 }, offset: 0, limit: 1, wanted: 0 })
    expect(activityWindow(2, 12)).toEqual({ aheadShown: { from: 10, to: 12 }, offset: 0, limit: 8, wanted: 8 })
  })
})

function client(answer: { data?: unknown; error?: { message: string; code?: string } | null }) {
  const rpc = vi.fn().mockResolvedValue({ data: answer.data ?? null, error: answer.error ?? null })
  return { supabase: { rpc } as unknown as SupabaseClient, rpc }
}

const FEE = {
  kind: "fee_paid",
  id: "p1",
  at: "2026-11-15T05:05:00+00:00",
  all_day: false,
  lead_id: "l1",
  admission_number: "ADMSN-12345",
  student_name: "SALMA JUMA MRISHO",
  class_name: "STD 4",
  payment_type: "first_instalment",
  amount: 600000,
  recorded_by: "Example Staff One",
}

describe("getHomeActivity", () => {
  it("maps the database's rows after the full classes, with the combined total", async () => {
    const { supabase, rpc } = client({ data: { total: 11, rows: [FEE] } })
    const full: FullClass[] = [{ className: "STD 6", taken: 35, seats: 35 }]
    const result = await getHomeActivity(supabase, 1, full)
    expect(rpc).toHaveBeenCalledWith("home_activity", { row_offset: 0, row_limit: 9 })
    expect(result).toEqual({
      ok: true,
      data: {
        total: 12,
        page: 1,
        pageCount: 2,
        rows: [
          { kind: "class_full", id: "STD 6", className: "STD 6", taken: 35, seats: 35 },
          {
            kind: "fee_paid",
            id: "p1",
            at: "2026-11-15T05:05:00+00:00",
            leadId: "l1",
            admissionNumber: "ADMSN-12345",
            studentName: "SALMA JUMA MRISHO",
            className: "STD 4",
            paymentType: "first_instalment",
            amount: 600000,
            recordedBy: "Example Staff One",
          },
        ],
      },
    })
  })

  it("leaves out a kind it does not know", async () => {
    const { supabase } = client({ data: { total: 2, rows: [{ kind: "later_kind", id: "x", at: "2026-11-15T05:00:00Z" }, FEE] } })
    const result = await getHomeActivity(supabase, 1)
    expect(result.ok && result.data.rows.map((row) => row.kind)).toEqual(["fee_paid"])
  })

  it("is forbidden when the database refuses and there is no full class", async () => {
    const { supabase } = client({ error: { message: "not_permitted" } })
    expect(await getHomeActivity(supabase, 1)).toEqual({ ok: false, error: "forbidden" })
  })

  it("still shows the full classes when the database refuses the rest", async () => {
    const { supabase } = client({ error: { message: "not_permitted" } })
    const result = await getHomeActivity(supabase, 1, [{ className: "FORM 1", taken: 40, seats: 40 }])
    expect(result.ok && result.data.total).toBe(1)
  })

  it("is unavailable on any other error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase } = client({ error: { message: "boom", code: "XX000" } })
    expect(await getHomeActivity(supabase, 1)).toEqual({ ok: false, error: "unavailable" })
  })

  it("reads an unreadable page as the first", async () => {
    const { supabase, rpc } = client({ data: { total: 0, rows: [] } })
    await getHomeActivity(supabase, Number.NaN)
    expect(rpc).toHaveBeenCalledWith("home_activity", { row_offset: 0, row_limit: 10 })
  })
})
