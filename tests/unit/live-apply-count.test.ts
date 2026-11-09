import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getAdmissionApplicationCount } from "@/lib/services/admission-applications"

// A client whose rpc answers `answer`, or never answers until its abort
// signal fires, as when Supabase stalls.
function client(answer?: { data: unknown; error: unknown }) {
  const seen: { name?: string; signal?: AbortSignal } = {}
  const supabase = {
    rpc: (name: string) => {
      seen.name = name
      return {
        abortSignal(signal: AbortSignal) {
          seen.signal = signal
          if (answer) return Promise.resolve(answer)
          return new Promise((resolve) => {
            signal.addEventListener("abort", () => resolve({ data: null, error: { message: "AbortError" } }))
          })
        },
      }
    },
  }
  return { supabase: supabase as unknown as SupabaseClient, seen }
}

describe("reading the Admission form application count", () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it("returns the count from admission_form_application_count", async () => {
    const { supabase, seen } = client({ data: 1284, error: null })
    await expect(getAdmissionApplicationCount(supabase)).resolves.toEqual({ ok: true, data: 1284 })
    expect(seen.name).toBe("admission_form_application_count")
  })

  it("is unavailable on an error or a non-number, and logs it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {})
    for (const answer of [{ data: null, error: { code: "42501" } }, { data: "12", error: null }]) {
      await expect(getAdmissionApplicationCount(client(answer).supabase)).resolves.toEqual({ ok: false, error: "unavailable" })
    }
    expect(log).toHaveBeenCalledTimes(2)
  })

  it("gives up after 2 seconds", async () => {
    vi.useFakeTimers()
    vi.spyOn(console, "error").mockImplementation(() => {})
    const { supabase, seen } = client()
    const read = getAdmissionApplicationCount(supabase)
    await vi.advanceTimersByTimeAsync(1999)
    expect(seen.signal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await expect(read).resolves.toEqual({ ok: false, error: "unavailable" })
  })

  it("never throws when the client does", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const supabase = { rpc: () => { throw new Error("boom") } } as unknown as SupabaseClient
    await expect(getAdmissionApplicationCount(supabase)).resolves.toEqual({ ok: false, error: "unavailable" })
  })
})
