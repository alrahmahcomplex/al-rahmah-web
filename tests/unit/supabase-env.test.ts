import { afterEach, describe, expect, it, vi } from "vitest"

import { supabaseEnv } from "@/utils/supabase/env"

afterEach(() => {
  vi.unstubAllEnvs()
})

describe("supabaseEnv", () => {
  it("reads the URL and the publishable key", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_fixture")

    expect(supabaseEnv()).toEqual({
      url: "http://127.0.0.1:55421",
      publishableKey: "sb_publishable_fixture",
    })
  })

  it("names the missing variables when the key is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")

    expect(() => supabaseEnv()).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set/,
    )
  })

  it("ignores the old anon key name", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:55421")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "")
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "sb_publishable_fixture")

    expect(() => supabaseEnv()).toThrow()
  })
})
