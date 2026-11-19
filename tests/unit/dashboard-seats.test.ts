import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

import { getSeatFiguresByClass, getSeatsByClass } from "@/lib/services/dashboard"

// The permission check comes first: a staff member without payments.view is
// refused without the streams or the Fee schedules being read at all.

function client(hasPaymentsView: boolean) {
  const rpc = vi.fn(async (name: string) =>
    name === "has_permission" ? { data: hasPaymentsView, error: null } : { data: [], error: null },
  )
  const from = vi.fn(() => ({
    select: () => ({ order: async () => ({ data: [], error: null }) }),
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
    expect(await getSeatsByClass(home.supabase)).toEqual({ ok: true, data: { year: null, years: [], streams: null } })
    expect(home.rpc).toHaveBeenCalledTimes(1)
    const reports = client(true)
    expect(await getSeatFiguresByClass(reports.supabase)).toEqual({ ok: true, data: { year: null, years: [], classes: [] } })
    expect(reports.rpc).toHaveBeenCalledTimes(1)
  })
})
