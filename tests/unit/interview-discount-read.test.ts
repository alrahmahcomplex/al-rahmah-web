import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { getInterviewDiscount } from "@/lib/services/referral"

// A client whose interview_discount() call never answers until its abort
// signal fires, as when Supabase stalls.
function stalledClient() {
  const seen: { signal?: AbortSignal } = {}
  const client = {
    rpc: () => ({
      abortSignal(signal: AbortSignal) {
        seen.signal = signal
        return new Promise((resolve) => {
          signal.addEventListener("abort", () => resolve({ data: null, error: { message: "AbortError" } }))
        })
      },
    }),
  }
  return { client: client as unknown as SupabaseClient, seen }
}

describe("reading the interview discount", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("gives up after 2 seconds by default, so an optional figure never holds up a fee", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { client, seen } = stalledClient()
    const read = getInterviewDiscount(client)
    await vi.advanceTimersByTimeAsync(1999)
    expect(seen.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(read).resolves.toEqual({ ok: false, error: "unavailable" })
  })

  it("uses the caller's signal when given one", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { client, seen } = stalledClient()
    const controller = new AbortController()
    const read = getInterviewDiscount(client, { signal: controller.signal })
    expect(seen.signal).toBe(controller.signal)
    controller.abort()
    await expect(read).resolves.toEqual({ ok: false, error: "unavailable" })
  })
})
