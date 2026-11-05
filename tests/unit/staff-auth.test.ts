import type { SupabaseClient } from "@supabase/supabase-js"
import { afterEach, describe, expect, it, vi } from "vitest"

import { acceptInvite, getStaffUser, requirePermission, signInStaff } from "@/lib/services/staff-auth"

const MANAGER_ROW = {
  id: "a1a1a1a1-0000-4000-8000-000000000001",
  full_name: "Test Manager",
  email: "manager@example.test",
  active: true,
  role_name: "Admissions Manager",
  permissions: ["leads.view", "staff.administer"],
}

const MANAGER = {
  id: MANAGER_ROW.id,
  name: "Test Manager",
  email: "manager@example.test",
  roleName: "Admissions Manager",
  permissions: ["leads.view", "staff.administer"],
}

type StaffRecordResponse = { data: unknown; error: { message: string; code?: string } | null }

// What PostgREST answers when its clock lags behind the token's issue time.
const ISSUED_AT_FUTURE: StaffRecordResponse = {
  data: null,
  error: { code: "PGRST303", message: "JWT issued at future" },
}

// A stand-in for the Supabase SDK: the only boundary these tests fake.
// `staffRecord` is what `current_staff_member` answers once signed in;
// `staffRecords`, when given, are its answers to successive calls.
// `startSignedIn` says whether the browser holds a session before the call;
// signing in, or using a link, starts one. `agentAccount` is what
// `current_agent_account` answers, for a browser signed in as an agent.
function fakeSupabase({
  startSignedIn = true,
  agentAccount = { data: null, error: null } as StaffRecordResponse,
  signInError = null as { message: string; code?: string } | null,
  staffRecord = { data: MANAGER_ROW, error: null } as StaffRecordResponse,
  staffRecords = undefined as StaffRecordResponse[] | undefined,
  sessionUser = true,
  getUserError = null as { message: string; status?: number } | null,
  verifyError = null as { message: string; code?: string; status?: number } | null,
  updateError = null as { message: string; code?: string; status?: number } | null,
} = {}) {
  const calls: string[] = []
  let signedIn = startSignedIn
  const maybeSingle = vi.fn()
  for (const response of staffRecords ?? []) maybeSingle.mockResolvedValueOnce(response)
  maybeSingle.mockResolvedValue(staffRecords?.at(-1) ?? staffRecord)
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const client = {
    auth: {
      signInWithPassword: vi.fn(async () => {
        if (!signInError) signedIn = true
        return { data: signInError ? { user: null } : { user: { id: "user" } }, error: signInError }
      }),
      getUser: vi.fn(async () =>
        signedIn && sessionUser
          ? { data: { user: { id: "user" } }, error: null }
          : { data: { user: null }, error: signedIn ? getUserError : { message: "Auth session missing!", status: 400 } },
      ),
      signOut,
      verifyOtp: vi.fn(async () => {
        calls.push("verifyOtp")
        if (!verifyError) signedIn = true
        return verifyError ? { data: { user: null }, error: verifyError } : { data: { user: { id: "invitee" } }, error: null }
      }),
      updateUser: vi.fn(async () => {
        calls.push("updateUser")
        return { data: {}, error: updateError }
      }),
    },
    rpc: vi.fn((fn: string) => {
      calls.push(fn)
      if (fn === "current_agent_account") return { maybeSingle: vi.fn().mockResolvedValue(agentAccount) }
      return { maybeSingle }
    }),
  }
  return { client: client as unknown as SupabaseClient, signOut, rpc: client.rpc, auth: client.auth, calls }
}

// A browser with no session yet, as on the sign-in page or an invite link.
function signedOut(options: Parameters<typeof fakeSupabase>[0] = {}) {
  return fakeSupabase({ startSignedIn: false, ...options })
}

describe("signInStaff", () => {
  it("refuses a wrong password", async () => {
    const { client } = signedOut({
      signInError: { message: "Invalid login credentials", code: "invalid_credentials" },
    })

    expect(await signInStaff(client, "manager@example.test", "wrong")).toEqual({
      ok: false,
      error: "invalid-credentials",
    })
  })

  it("reports an outage as unavailable rather than blaming the password", async () => {
    const { client } = signedOut({
      signInError: { message: "request failed", code: "unexpected_failure" },
    })

    expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "unavailable",
    })
  })

  it("reports a rate limit as its own refusal", async () => {
    for (const signInError of [
      { message: "Request rate limit reached", code: "over_request_rate_limit" },
      { message: "Too many requests", status: 429 },
    ]) {
      const { client } = signedOut({ signInError })

      expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({
        ok: false,
        error: "rate-limited",
      })
    }
  })

  it("reports a banned login as its own refusal", async () => {
    const { client } = signedOut({ signInError: { message: "User is banned", code: "user_banned" } })

    expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({ ok: false, error: "banned" })
  })

  it("refuses while this browser is signed in as a Discount code holder, before trying the password", async () => {
    const { client, auth } = fakeSupabase({
      staffRecord: { data: null, error: null },
      agentAccount: { data: { state: "active" }, error: null },
    })

    expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "agent-session",
    })
    expect(auth.signInWithPassword).not.toHaveBeenCalled()
  })

  it("signs in an active staff member with their role and permissions, and keeps the session", async () => {
    const { client, signOut } = signedOut()

    expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({
      ok: true,
      data: MANAGER,
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("refuses an account with no staff record and ends the session", async () => {
    const { client, signOut } = signedOut({ staffRecord: { data: null, error: null } })

    expect(await signInStaff(client, "someone@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "not-staff",
    })
    expect(signOut).toHaveBeenCalled()
  })

  it("refuses a deactivated staff member and ends the session", async () => {
    const { client, signOut } = signedOut({
      staffRecord: { data: { ...MANAGER_ROW, active: false, permissions: [] }, error: null },
    })

    expect(await signInStaff(client, "deactivated@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "deactivated",
    })
    expect(signOut).toHaveBeenCalled()
  })

  it("refuses and ends the session when the staff record cannot be read", async () => {
    const { client, signOut } = signedOut({
      staffRecord: { data: null, error: { message: "connection refused" } },
    })

    expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "unavailable",
    })
    expect(signOut).toHaveBeenCalled()
  })
})

// PostgREST can briefly judge a token that was just issued as "issued at
// future" when its cached clock lags. The staff record read tries once more
// after a second; any other failure, or a second rejection, is still a no.
describe("reading the staff record when PostgREST's clock lags", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  async function withTimersRunning<T>(pending: Promise<T>): Promise<T> {
    await vi.runAllTimersAsync()
    return pending
  }

  it("signs in once a second read is accepted", async () => {
    vi.useFakeTimers()
    const { client, signOut, rpc } = signedOut({
      staffRecords: [ISSUED_AT_FUTURE, { data: MANAGER_ROW, error: null }],
    })

    expect(await withTimersRunning(signInStaff(client, "manager@example.test", "fixture-password"))).toEqual({
      ok: true,
      data: MANAGER,
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(signOut).not.toHaveBeenCalled()
  })

  it("waits before reading again, giving PostgREST's clock time to catch up", async () => {
    vi.useFakeTimers()
    const { client, rpc } = fakeSupabase({
      staffRecords: [ISSUED_AT_FUTURE, { data: MANAGER_ROW, error: null }],
    })

    const pending = getStaffUser(client)
    await vi.advanceTimersByTimeAsync(999)
    expect(rpc).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(await pending).toEqual({ ok: true, data: MANAGER })
    expect(rpc).toHaveBeenCalledTimes(2)
  })

  it("fails closed and ends the session when the second read is rejected too", async () => {
    vi.useFakeTimers()
    const { client, signOut, rpc } = signedOut({ staffRecords: [ISSUED_AT_FUTURE, ISSUED_AT_FUTURE] })

    expect(await withTimersRunning(signInStaff(client, "manager@example.test", "fixture-password"))).toEqual({
      ok: false,
      error: "unavailable",
    })
    expect(rpc).toHaveBeenCalledTimes(2)
    expect(signOut).toHaveBeenCalled()
  })

  it("does not read again after any other failure", async () => {
    for (const error of [
      { code: "PGRST303", message: "JWT expired" },
      { code: "PGRST301", message: "JWT could not be decoded" },
      { message: "connection refused" },
    ]) {
      const { client, rpc } = fakeSupabase({ staffRecord: { data: null, error } })

      expect(await getStaffUser(client)).toEqual({ ok: false, error: "unavailable" })
      expect(rpc).toHaveBeenCalledTimes(1)
    }
  })
})

describe("getStaffUser", () => {
  it("returns the signed-in staff member", async () => {
    const { client } = fakeSupabase()

    expect(await getStaffUser(client)).toEqual({ ok: true, data: MANAGER })
  })

  it("reports a visitor with no session as signed out", async () => {
    const { client } = fakeSupabase({ sessionUser: false })

    expect(await getStaffUser(client)).toEqual({ ok: false, error: "signed-out" })
  })

  it("refuses a session whose staff member has since been deactivated", async () => {
    const { client } = fakeSupabase({
      staffRecord: { data: { ...MANAGER_ROW, active: false, permissions: [] }, error: null },
    })

    expect(await getStaffUser(client)).toEqual({ ok: false, error: "deactivated" })
  })

  it("fails closed when the staff record cannot be read", async () => {
    const { client } = fakeSupabase({
      staffRecord: { data: null, error: { message: "connection refused" } },
    })

    expect(await getStaffUser(client)).toEqual({ ok: false, error: "unavailable" })
  })
})

describe("requirePermission", () => {
  it("returns the staff member when their role holds the permission", async () => {
    const { client } = fakeSupabase()

    expect(await requirePermission(client, "staff.administer")).toEqual({ ok: true, data: MANAGER })
  })

  it("is forbidden when their role does not hold the permission", async () => {
    const { client } = fakeSupabase()

    expect(await requirePermission(client, "payments.record")).toEqual({ ok: false, error: "forbidden" })
  })

  it("passes on why a session is not a usable staff member", async () => {
    const { client } = fakeSupabase({ sessionUser: false })

    expect(await requirePermission(client, "leads.view")).toEqual({ ok: false, error: "signed-out" })
  })

  it("fails closed when the check cannot run", async () => {
    const { client } = fakeSupabase({
      staffRecord: { data: null, error: { message: "connection refused" } },
    })

    expect(await requirePermission(client, "leads.view")).toEqual({ ok: false, error: "unavailable" })
  })
})

describe("acceptInvite", () => {
  it("refuses while this browser is signed in as a Discount code holder, leaving the token unused", async () => {
    const { client, auth } = fakeSupabase({
      staffRecord: { data: null, error: null },
      agentAccount: { data: { state: "active" }, error: null },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "agent-session" })
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it("uses the invite token, sets the password, then checks the staff record", async () => {
    const { client, auth, calls, signOut } = signedOut()

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: true, data: MANAGER })
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "invite" })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "a-new-password" })
    expect(calls).toEqual(["verifyOtp", "updateUser", "current_staff_member"])
    expect(signOut).not.toHaveBeenCalled()
  })

  it("refuses a short password without touching the token", async () => {
    const { client, calls } = signedOut()

    expect(await acceptInvite(client, "hash-1", "short")).toEqual({ ok: false, error: "password-too-short" })
    expect(calls).toEqual([])
  })

  it("reports an expired or used link", async () => {
    const { client, calls } = signedOut({
      verifyError: { message: "Email link is invalid or has expired", code: "otp_expired", status: 403 },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "invalid-link" })
    expect(calls).toEqual(["verifyOtp"])
  })

  it("reports an outage while checking the link as unavailable, so the person can try again", async () => {
    const { client } = signedOut({ verifyError: { message: "fetch failed", status: 0 } })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "unavailable" })
  })

  it("signs out someone deactivated before accepting, keeping the password for if they are reactivated", async () => {
    const { client, calls, signOut } = signedOut({
      staffRecord: { data: { ...MANAGER_ROW, active: false, permissions: [] }, error: null },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "deactivated" })
    expect(calls).toEqual(["verifyOtp", "updateUser", "current_staff_member"])
    expect(signOut).toHaveBeenCalled()
  })

  it("keeps the session when the password can't be saved, and names the account the token verified", async () => {
    const { client, signOut, calls, auth } = signedOut({ updateError: { message: "boom", status: 500 } })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({
      ok: false,
      error: "password-not-saved",
      userId: "invitee",
    })
    // Taken from the verification itself; the only session read is the
    // one-account check before the token is used.
    expect(auth.getUser).toHaveBeenCalledTimes(1)
    expect(calls).toEqual(["verifyOtp", "updateUser"])
    expect(signOut).not.toHaveBeenCalled()
  })

  it("names the same account again when a retry's password save fails too", async () => {
    const { client } = fakeSupabase({ updateError: { message: "boom", status: 500 } })

    expect(await acceptInvite(client, "hash-1", "a-new-password", { verifiedUserId: "user" })).toEqual({
      ok: false,
      error: "password-not-saved",
      userId: "user",
    })
  })

  it("on a retry for a link this browser already used, skips the spent token and sets the password", async () => {
    const { client, calls, auth } = fakeSupabase()

    expect(await acceptInvite(client, "hash-1", "a-new-password", { verifiedUserId: "user" })).toEqual({
      ok: true,
      data: MANAGER,
    })
    expect(auth.verifyOtp).not.toHaveBeenCalled()
    // The first read is the one-account check.
    expect(calls).toEqual(["current_staff_member", "updateUser", "current_staff_member"])
  })

  it("refuses a retry when someone else is signed in, and changes nobody's password", async () => {
    const { client, calls } = fakeSupabase()

    expect(await acceptInvite(client, "hash-1", "a-new-password", { verifiedUserId: "the-invitee" })).toEqual({
      ok: false,
      error: "invalid-link",
    })
    expect(calls).toEqual(["current_staff_member"])
  })

  it("treats a retry with no session left as a spent link", async () => {
    const { client, calls } = fakeSupabase({
      sessionUser: false,
      getUserError: { message: "Auth session missing!", status: 400 },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password", { verifiedUserId: "user" })).toEqual({
      ok: false,
      error: "invalid-link",
    })
    expect(calls).toEqual([])
  })

  it("reports a retry whose session check fails for a moment as unavailable, so it can run again", async () => {
    const { client, calls } = fakeSupabase({
      sessionUser: false,
      getUserError: { message: "fetch failed", status: 0 },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password", { verifiedUserId: "user" })).toEqual({
      ok: false,
      error: "unavailable",
    })
    expect(calls).toEqual([])
  })

  it("tells someone whose password was saved to sign in when the staff check can't run", async () => {
    const { client, calls, signOut } = signedOut({
      staffRecord: { data: null, error: { message: "fetch failed" } },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "joined-unavailable" })
    expect(calls).toEqual(["verifyOtp", "updateUser", "current_staff_member"])
    expect(signOut).toHaveBeenCalled()
  })
})
