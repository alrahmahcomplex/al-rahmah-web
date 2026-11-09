import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { signedInHome, signIn } from "@/lib/services/sign-in"

// Cloudflare's dummy Turnstile token, what the always-pass test site key gives.
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX"

type Answer = { data: unknown; error: { message: string; code?: string } | null }

const STAFF_ROW = {
  id: "a1a1a1a1-0000-4000-8000-000000000001",
  full_name: "Test Manager",
  email: "manager@example.test",
  active: true,
  role_name: "Admissions Manager",
  permissions: ["leads.view"],
  super_admin: false,
  managed_role_ids: [],
}
const NO_ROW: Answer = { data: null, error: null }
const STAFF: Answer = { data: STAFF_ROW, error: null }
const AGENT: Answer = { data: { state: "active", full_name: "Neema Juma", code: "NEEMA-01" }, error: null }
const ISSUED_AT_FUTURE: Answer = { data: null, error: { code: "PGRST303", message: "JWT issued at future" } }

// A stand-in for the Supabase SDK, the only boundary these tests fake.
// `staff` and `agent` are what current_staff_member and current_agent_account
// answer once signed in; `staffAnswers` are answers given first, in order.
function fakeSupabase({
  signedIn = false,
  signInError = null as { message: string; code?: string; status?: number } | null,
  staff = NO_ROW,
  agent = NO_ROW,
  staffAnswers = [] as Answer[],
} = {}) {
  let session = signedIn
  const signOut = vi.fn(async () => {
    session = false
    return { error: null }
  })
  const client = {
    auth: {
      signInWithPassword: vi.fn(async () => {
        if (!signInError) session = true
        return { data: {}, error: signInError }
      }),
      getUser: vi.fn(async () =>
        session
          ? { data: { user: { id: "user" } }, error: null }
          : { data: { user: null }, error: { message: "Auth session missing!", status: 400 } },
      ),
      getClaims: vi.fn(async () => (session ? { data: { claims: { sub: "user" } }, error: null } : { data: null, error: null })),
      signOut,
    },
    rpc: vi.fn((fn: string) => ({
      maybeSingle: vi.fn(async () => {
        if (fn === "current_staff_member") return staffAnswers.shift() ?? staff
        if (fn === "current_agent_account") return agent
        return NO_ROW
      }),
    })),
  }
  return { client: client as unknown as SupabaseClient, auth: client.auth, rpc: client.rpc, signOut }
}

describe("signing in on the one sign-in page", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("sends an active staff member to the staff side and keeps the session", async () => {
    const { client, signOut } = fakeSupabase({ staff: STAFF })

    expect(await signIn(client, "manager@example.test", "fixture-password", TOKEN)).toEqual({ ok: true, data: "staff" })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("sends a switched-on Discount code holder to their students and keeps the session", async () => {
    const { client, signOut } = fakeSupabase({ agent: AGENT })

    expect(await signIn(client, "neema@example.test", "fixture-password", TOKEN)).toEqual({ ok: true, data: "agent" })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("never sends a staff login to the agent side, even if both answer", async () => {
    const { client } = fakeSupabase({ staff: STAFF, agent: AGENT })

    expect(await signIn(client, "manager@example.test", "fixture-password", TOKEN)).toEqual({ ok: true, data: "staff" })
  })

  it.each([
    [{ message: "Invalid login credentials", code: "invalid_credentials" }, "invalid-credentials"],
    [{ message: "slow down", status: 429 }, "rate-limited"],
    [{ message: "banned", code: "user_banned" }, "banned"],
    [{ message: "captcha protection: request disallowed (invalid-input-response)", code: "captcha_failed", status: 400 }, "check-failed"],
    [{ message: "request failed", code: "unexpected_failure" }, "unavailable"],
  ] as const)("reports a refused password (%o) as %s and reads no records", async (signInError, error) => {
    const { client, rpc } = fakeSupabase({ signInError, staff: STAFF })

    expect(await signIn(client, "manager@example.test", "wrong", TOKEN)).toEqual({ ok: false, error })
    expect(rpc).not.toHaveBeenCalled()
  })

  it("sends the Turnstile token to Supabase as captchaToken", async () => {
    const { client, auth } = fakeSupabase({ staff: STAFF })

    await signIn(client, "manager@example.test", "fixture-password", TOKEN)
    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: "manager@example.test",
      password: "fixture-password",
      options: { captchaToken: TOKEN },
    })
  })

  it("sends nothing to Supabase without a Turnstile token", async () => {
    const { client, auth, rpc } = fakeSupabase({ staff: STAFF })

    expect(await signIn(client, "manager@example.test", "fixture-password", "")).toEqual({ ok: false, error: "check-pending" })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("refuses a deactivated staff member and ends the session, without trying the agent side", async () => {
    const { client, signOut, rpc } = fakeSupabase({ staff: { data: { ...STAFF_ROW, active: false }, error: null }, agent: AGENT })

    expect(await signIn(client, "manager@example.test", "fixture-password", TOKEN)).toEqual({ ok: false, error: "deactivated" })
    expect(signOut).toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalledWith("current_agent_account")
  })

  it.each([
    ["switched_off", "switched-off"],
    ["retired", "retired"],
    ["access_off", "access-off"],
  ] as const)("refuses an agent in state %s and ends the session", async (state, error) => {
    const { client, signOut } = fakeSupabase({ agent: { data: { state, full_name: null, code: null }, error: null } })

    expect(await signIn(client, "neema@example.test", "fixture-password", TOKEN)).toEqual({ ok: false, error })
    expect(signOut).toHaveBeenCalled()
  })

  it("refuses a login that is neither staff nor agent and ends the session", async () => {
    const { client, signOut } = fakeSupabase()

    expect(await signIn(client, "someone@example.test", "fixture-password", TOKEN)).toEqual({ ok: false, error: "no-account" })
    expect(signOut).toHaveBeenCalled()
  })

  it("fails closed when either record can't be read", async () => {
    for (const options of [{ staff: { data: null, error: { message: "connection refused" } } }, { agent: { data: null, error: { message: "connection refused" } } }]) {
      const { client, signOut } = fakeSupabase(options)

      expect(await signIn(client, "someone@example.test", "fixture-password", TOKEN)).toEqual({ ok: false, error: "unavailable" })
      expect(signOut).toHaveBeenCalled()
    }
  })

  it("signs staff in once PostgREST's lagging clock accepts the second read", async () => {
    vi.useFakeTimers()
    const { client } = fakeSupabase({ staffAnswers: [ISSUED_AT_FUTURE], staff: STAFF })

    const pending = signIn(client, "manager@example.test", "fixture-password", TOKEN)
    await vi.runAllTimersAsync()
    expect(await pending).toEqual({ ok: true, data: "staff" })
  })
})

describe("where /login sends a browser that is already signed in", () => {
  it("shows the form to a signed-out browser", async () => {
    expect(await signedInHome(fakeSupabase().client)).toBeNull()
  })

  it("sends active staff to /staff and an active agent to their students", async () => {
    expect(await signedInHome(fakeSupabase({ signedIn: true, staff: STAFF }).client)).toBe("/staff")
    expect(await signedInHome(fakeSupabase({ signedIn: true, agent: AGENT }).client)).toBe("/discount-code/students")
  })

  it("keeps a deactivated staff member or a switched-off agent on the page, so nobody bounces between pages", async () => {
    expect(await signedInHome(fakeSupabase({ signedIn: true, staff: { data: { ...STAFF_ROW, active: false }, error: null } }).client)).toBeNull()
    expect(
      await signedInHome(fakeSupabase({ signedIn: true, agent: { data: { state: "switched_off", full_name: null, code: null }, error: null } }).client),
    ).toBeNull()
  })
})
