import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { resetPasswordFromLink } from "@/lib/services/password-reset"

type Answer = { data: unknown; error: { message: string; code?: string } | null }

const NO_ROW: Answer = { data: null, error: null }
const STAFF = (active: boolean): Answer => ({
  data: {
    id: "a1a1a1a1-0000-4000-8000-000000000001",
    full_name: "Test Manager",
    email: "manager@example.test",
    active,
    role_name: "Admissions Manager",
    permissions: [],
    super_admin: false,
    managed_role_ids: [],
  },
  error: null,
})
const AGENT = (state: string): Answer => ({ data: { state, full_name: "Neema Juma", code: "NEEMA-01" }, error: null })

// A stand-in for the Supabase SDK: the link is spent, the password saved, and
// current_staff_member and current_agent_account answer as given.
function fakeSupabase({
  staff = NO_ROW,
  agent = NO_ROW,
  verifyError = null as { message: string; status?: number } | null,
  updateError = null as { message: string } | null,
} = {}) {
  let session = false
  const client = {
    auth: {
      verifyOtp: vi.fn(async () => {
        if (verifyError) return { data: { user: null }, error: verifyError }
        session = true
        return { data: { user: { id: "user-1" } }, error: null }
      }),
      updateUser: vi.fn(async () => ({ data: {}, error: updateError })),
      getUser: vi.fn(async () =>
        session ? { data: { user: { id: "user-1" } }, error: null } : { data: { user: null }, error: { message: "missing", status: 400 } },
      ),
      signOut: vi.fn(async () => {
        session = false
        return { error: null }
      }),
    },
    rpc: vi.fn((fn: string) => ({
      maybeSingle: vi.fn(async () => (fn === "current_staff_member" ? staff : fn === "current_agent_account" ? agent : NO_ROW)),
    })),
  }
  return { client: client as unknown as SupabaseClient, auth: client.auth }
}

const PASSWORD = "a-long-new-password"

describe("the shared reset page", () => {
  it("lands an active staff member on the staff side, signed in", async () => {
    const { client, auth } = fakeSupabase({ staff: STAFF(true) })
    expect(await resetPasswordFromLink(client, "token", PASSWORD)).toEqual({ ok: true, data: "staff" })
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "token", type: "recovery" })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: PASSWORD })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it("lands a switched-on agent on the Discount code pages", async () => {
    const { client, auth } = fakeSupabase({ agent: AGENT("active") })
    expect(await resetPasswordFromLink(client, "token", PASSWORD)).toEqual({ ok: true, data: "agent" })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it.each([
    ["a deactivated staff member", { staff: STAFF(false) }, "deactivated"],
    ["a switched-off agent", { agent: AGENT("switched_off") }, "switched-off"],
    ["an agent while agent access is off", { agent: AGENT("access_off") }, "access-off"],
    ["a login that is nobody's", {}, "no-account"],
  ])("keeps the new password but signs out %s", async (_label, answers, error) => {
    const { client, auth } = fakeSupabase(answers)
    expect(await resetPasswordFromLink(client, "token", PASSWORD)).toEqual({ ok: false, error })
    expect(auth.updateUser).toHaveBeenCalled()
    expect(auth.signOut).toHaveBeenCalled()
  })

  it("says an expired or used link is invalid", async () => {
    const { client, auth } = fakeSupabase({ verifyError: { message: "expired", status: 403 } })
    expect(await resetPasswordFromLink(client, "token", PASSWORD)).toEqual({ ok: false, error: "invalid-link" })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it("refuses a short password before touching the link", async () => {
    const { client, auth } = fakeSupabase({ staff: STAFF(true) })
    expect(await resetPasswordFromLink(client, "token", "short")).toEqual({ ok: false, error: "password-too-short" })
    expect(auth.verifyOtp).not.toHaveBeenCalled()
  })

  it("names the account when the link was spent but the password not saved, for a retry", async () => {
    const { client } = fakeSupabase({ staff: STAFF(true), updateError: { message: "down" } })
    expect(await resetPasswordFromLink(client, "token", PASSWORD)).toEqual({ ok: false, error: "password-not-saved", userId: "user-1" })
  })
})

describe("the retry cookie", () => {
  it("allows a retry only for the same link, naming the account it signed in", async () => {
    const { retryFor } = await import("@/lib/password-reset")
    expect(retryFor("token-a user-1", "token-a")).toBe("user-1")
    expect(retryFor("token-a user-1", "token-b")).toBeNull()
    expect(retryFor("token-a", "token-a")).toBeNull()
    expect(retryFor(undefined, "token-a")).toBeNull()
  })
})
