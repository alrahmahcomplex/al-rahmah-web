import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

import { getSeatsByClass } from "@/lib/services/dashboard"

// The permission check comes before anything of slice 9's: a staff member
// without payments.view is refused without the seats or the Fee schedules
// being read at all.

function client(hasPaymentsView: boolean) {
  const rpc = vi.fn(async (name: string) =>
    name === "has_permission" ? { data: hasPaymentsView, error: null } : { data: [], error: null },
  )
  const from = vi.fn(() => ({
    select: () => ({ order: async () => ({ data: [], error: null }) }),
  }))
  return { rpc, from, supabase: { rpc, from } as unknown as SupabaseClient }
}

describe("getSeatsByClass", () => {
  test("without payments.view it returns forbidden and never calls slice 9", async () => {
    const { rpc, from, supabase } = client(false)
    expect(await getSeatsByClass(supabase, 2031)).toEqual({ ok: false, error: "forbidden" })
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith("has_permission", { permission: "payments.view" })
    expect(from).not.toHaveBeenCalled()
  })

  test("with no Fee schedule it shows no year and asks for no seats", async () => {
    const { rpc, supabase } = client(true)
    expect(await getSeatsByClass(supabase)).toEqual({ ok: true, data: { year: null, years: [], classes: [] } })
    expect(rpc).not.toHaveBeenCalledWith("year_seats", expect.anything())
  })
})
