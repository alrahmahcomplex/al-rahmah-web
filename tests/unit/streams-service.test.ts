import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test, vi } from "vitest"

import { editStream, getSeatMode } from "@/lib/services/streams"

// The streams service (#449): a refusal below the children placed carries the
// database's count, which may be higher than the screen showed; a failed read
// of the seat mode never shows the new screens.

function client(result: { data?: unknown; error?: unknown }) {
  return { rpc: vi.fn(async () => ({ data: result.data ?? null, error: result.error ?? null })) } as unknown as SupabaseClient
}

const change = { streamId: "s1", label: "B", seats: 12 }

describe("editStream", () => {
  test("a below_placed refusal returns the database's count", async () => {
    const supabase = client({ error: { message: "below_placed", code: "P0001", details: '{"placed": 13}' } })
    expect(await editStream(supabase, change)).toEqual({ ok: false, error: "below_placed", placed: 13 })
  })

  test("a below_placed refusal without a readable count returns null", async () => {
    const supabase = client({ error: { message: "below_placed", code: "P0001", details: "not json" } })
    expect(await editStream(supabase, change)).toEqual({ ok: false, error: "below_placed", placed: null })
  })

  test("other refusals carry no count", async () => {
    const supabase = client({ error: { message: "label_taken", code: "P0001" } })
    expect(await editStream(supabase, change)).toEqual({ ok: false, error: "label_taken" })
  })
})

describe("getSeatMode", () => {
  test("is legacy when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await getSeatMode(client({ error: { message: "boom" } }))).toBe("legacy")
    expect(await getSeatMode(client({ data: "named" }))).toBe("named")
  })
})
