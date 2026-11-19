import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

import { setAcademicYear } from "@/lib/services/fees"

// What the fees module sends set_academic_year, and how it reads a refusal,
// without the database. Seats are set in streams (#449), so none is ever sent.

function client(error: unknown = null) {
  const rpc = vi.fn(async () => ({ data: null, error }))
  return { rpc, supabase: { rpc } as unknown as SupabaseClient }
}

describe("setAcademicYear", () => {
  test("sends a changed start with the one it replaces, and no seats", async () => {
    const { rpc, supabase } = client()
    expect(await setAcademicYear(supabase, 2031, { start: "2031-01-06" }, { start: null })).toEqual({ ok: true, data: null })
    expect(rpc).toHaveBeenCalledWith("set_academic_year", {
      schedule_year: 2031,
      settings: { academic_year_start: "2031-01-06", academic_year_start_was: null },
    })
  })

  test("sends nothing to change when the start is as it was", async () => {
    const { rpc, supabase } = client()
    await setAcademicYear(supabase, 2031, { start: "2031-01-06" }, { start: "2031-01-06" })
    expect(rpc).toHaveBeenCalledWith("set_academic_year", { schedule_year: 2031, settings: {} })
  })

  test("reads seats_moved as out of date, so a form left open reloads", async () => {
    const { supabase } = client({ message: "seats_moved", code: "P0001" })
    expect(await setAcademicYear(supabase, 2031, { start: null }, { start: null })).toEqual({ ok: false, error: { kind: "stale", field: null } })
  })

  test("names the start when the database refuses it", async () => {
    const { supabase } = client({ message: "stale", code: "P0001", details: '{"field": "academic_year_start"}' })
    expect(await setAcademicYear(supabase, 2031, { start: "2031-01-06" }, { start: null })).toEqual({
      ok: false,
      error: { kind: "stale", field: "academic_year_start" },
    })
  })
})
