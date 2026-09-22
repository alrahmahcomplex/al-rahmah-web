import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { getStaffUser, signInStaff } from "@/lib/services/staff-auth"

// A stand-in for the Supabase SDK: the only boundary these tests fake.
function fakeSupabase({
  signInError = null as { message: string; code?: string } | null,
  isAdmin = true,
  sessionEmail = "staff@example.test" as string | null,
} = {}) {
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const client = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        data: signInError ? { user: null } : { user: { email: "staff@example.test" } },
        error: signInError,
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: sessionEmail ? { email: sessionEmail } : null },
        error: null,
      }),
      signOut,
    },
    rpc: vi.fn().mockResolvedValue({ data: isAdmin, error: null }),
  }
  return { client: client as unknown as SupabaseClient, signOut }
}

describe("signInStaff", () => {
  it("refuses a wrong password", async () => {
    const { client } = fakeSupabase({
      signInError: { message: "Invalid login credentials", code: "invalid_credentials" },
    })

    const result = await signInStaff(client, "staff@example.test", "wrong")

    expect(result).toEqual({ ok: false, error: "invalid-credentials" })
  })

  it("refuses a correct password for an email missing from the allowlist and ends the session", async () => {
    const { client, signOut } = fakeSupabase({ isAdmin: false })

    const result = await signInStaff(client, "former-staff@example.test", "fixture-password")

    expect(result).toEqual({ ok: false, error: "not-on-allowlist" })
    expect(signOut).toHaveBeenCalled()
  })

  it("signs in staff on the allowlist and keeps the session", async () => {
    const { client, signOut } = fakeSupabase({ isAdmin: true })

    const result = await signInStaff(client, "staff@example.test", "fixture-password")

    expect(result).toEqual({ ok: true, data: { email: "staff@example.test" } })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("refuses and ends the session when the allowlist cannot be checked", async () => {
    const { client, signOut } = fakeSupabase()
    vi.mocked(client.rpc).mockResolvedValue({
      data: null,
      error: { message: "connection refused" },
    } as never)

    const result = await signInStaff(client, "staff@example.test", "fixture-password")

    expect(result).toEqual({ ok: false, error: "unavailable" })
    expect(signOut).toHaveBeenCalled()
  })
})

describe("getStaffUser", () => {
  it("returns the signed-in staff member", async () => {
    const { client } = fakeSupabase({ sessionEmail: "staff@example.test", isAdmin: true })

    expect(await getStaffUser(client)).toEqual({ ok: true, data: { email: "staff@example.test" } })
  })

  it("reports a visitor with no session as signed out", async () => {
    const { client } = fakeSupabase({ sessionEmail: null })

    expect(await getStaffUser(client)).toEqual({ ok: false, error: "signed-out" })
  })

  it("refuses a session whose email has left the allowlist", async () => {
    const { client } = fakeSupabase({ sessionEmail: "former-staff@example.test", isAdmin: false })

    expect(await getStaffUser(client)).toEqual({ ok: false, error: "not-on-allowlist" })
  })
})
