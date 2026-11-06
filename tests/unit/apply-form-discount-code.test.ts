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

  it("sends the notice version with the one call it makes", async () => {
    const { supabase, calls } = client({ data: "BJN-402", error: null })
    await expect(applyFormDiscountCode(supabase, LEAD, "BJN-402", "form_v1")).resolves.toEqual({
      ok: true,
      data: { code: "BJN-402" },
    })
    expect(calls).toEqual([
      { fn: "apply_form_discount_code", args: { lead_id: LEAD, code: "BJN-402", notice_version: "form_v1" } },
    ])
  })

  it("sends a null version when the page showed no notice", async () => {
    const { supabase, calls } = client({ data: "BJN-402", error: null })
    await expect(applyFormDiscountCode(supabase, LEAD, "BJN-402", null)).resolves.toEqual({ ok: true, data: { code: "BJN-402" } })
    expect(calls).toEqual([{ fn: "apply_form_discount_code", args: { lead_id: LEAD, code: "BJN-402", notice_version: null } }])
  })

  // The two-argument function is gone (#196). A missing function is a failure
  // like any other, never a second call without the version.
  it("does not call the two-argument version when the function is missing", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase, calls } = client(missingFunction, { data: "BJN-402", error: null })
    await expect(applyFormDiscountCode(supabase, LEAD, "BJN-402", "form_v1")).resolves.toEqual({
      ok: false,
      error: "unavailable",
    })
    expect(calls).toEqual([
      { fn: "apply_form_discount_code", args: { lead_id: LEAD, code: "BJN-402", notice_version: "form_v1" } },
    ])
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("reads the function's refusals, and retries on none of them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const cases: Array<[Answer["error"], string]> = [
      [{ message: "invalid" }, "invalid"],
      [{ message: "lead_closed" }, "lead-closed"],
      [{ message: "not_found" }, "not-found"],
      [{ message: "boom", code: "22P02" }, "not-found"],
      [{ message: "boom", code: "XX000" }, "unavailable"],
    ]
    for (const [error, expected] of cases) {
      const { supabase, calls } = client({ data: null, error })
      await expect(applyFormDiscountCode(supabase, LEAD, "BJN-402", "form_v1")).resolves.toEqual({ ok: false, error: expected })
      expect(calls).toHaveLength(1)
    }
  })
})
