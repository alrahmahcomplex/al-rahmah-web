import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { applyFormDiscountCode } from "@/lib/services/referral"

type Answer = { data: unknown; error: { message: string; code?: string } | null }

// A client that answers each rpc call in turn from `answers` and records the
// arguments it was called with.
function client(...answers: Answer[]) {
  const calls: Array<{ fn: string; args: Record<string, unknown> }> = []
  const supabase = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args })
      return Promise.resolve(answers[calls.length - 1])
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, calls }
}

const LEAD = "6a0b3a1e-4a39-4c7e-9a52-6f3f7c1f0a11"
const missingFunction = { data: null, error: { message: "Could not find the function", code: "PGRST202" } }

describe("putting the form's Discount code on a lead", () => {
  afterEach(() => vi.restoreAllMocks())

  it("sends the notice version to the three-argument function", async () => {
    const { supabase, calls } = client({ data: "BJN-402", error: null })
    await expect(applyFormDiscountCode(supabase, LEAD, "BJN-402", "form_v1")).resolves.toEqual({
      ok: true,
      data: { code: "BJN-402" },
    })
    expect(calls).toEqual([
      { fn: "apply_form_discount_code", args: { lead_id: LEAD, code: "BJN-402", notice_version: "form_v1" } },
    ])
  })

  it("falls back to the two-argument function while the migration has not applied", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { supabase, calls } = client(missingFunction, { data: "BJN-402", error: null })
    await expect(applyFormDiscountCode(supabase, LEAD, "BJN-402", "form_v1")).resolves.toEqual({
      ok: true,
      data: { code: "BJN-402" },
    })
    expect(calls[1]).toEqual({ fn: "apply_form_discount_code", args: { lead_id: LEAD, code: "BJN-402" } })
  })

  it("reads the fallback's errors the same way", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { supabase } = client(missingFunction, { data: null, error: { message: "lead_closed" } })
    await expect(applyFormDiscountCode(supabase, LEAD, "BJN-402", null)).resolves.toEqual({
      ok: false,
      error: "lead-closed",
    })
  })

  it("does not retry on any other error", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    for (const error of [{ message: "invalid" }, { message: "boom", code: "XX000" }]) {
      const { supabase, calls } = client({ data: null, error })
      const result = await applyFormDiscountCode(supabase, LEAD, "BJN-402", "form_v1")
      expect(result.ok).toBe(false)
      expect(calls).toHaveLength(1)
    }
  })
})
