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
// `staffRecord` is what `current_staff_member` answers; `staffRecords`, when
// given, are its answers to successive calls.
function fakeSupabase({
  signInError = null as { message: string; code?: string } | null,
  staffRecord = { data: MANAGER_ROW, error: null } as StaffRecordResponse,
  staffRecords = undefined as StaffRecordResponse[] | undefined,
  sessionUser = true,
  verifyError = null as { message: string; code?: string; status?: number } | null,
  updateError = null as { message: string; code?: string; status?: number } | null,
} = {}) {
  const calls: string[] = []
  const maybeSingle = vi.fn()
  for (const response of staffRecords ?? []) maybeSingle.mockResolvedValueOnce(response)
  maybeSingle.mockResolvedValue(staffRecords?.at(-1) ?? staffRecord)
  const signOut = vi.fn().mockResolvedValue({ error: null })
  const client = {
    auth: {
      signInWithPassword: vi.fn().mockResolvedValue({
        data: signInError ? { user: null } : { user: { id: "user" } },
        error: signInError,
      }),
      getUser: vi.fn().mockResolvedValue({
        data: { user: sessionUser ? { id: "user" } : null },
        error: null,
      }),
      signOut,
      verifyOtp: vi.fn(async () => {
        calls.push("verifyOtp")
        return verifyError ? { data: { user: null }, error: verifyError } : { data: { user: { id: "invitee" } }, error: null }
      }),
      updateUser: vi.fn(async () => {
        calls.push("updateUser")
        return { data: {}, error: updateError }
      }),
    },
    rpc: vi.fn((fn: string) => {
      calls.push(fn)
      return { maybeSingle }
    }),
  }
  return { client: client as unknown as SupabaseClient, signOut, rpc: client.rpc, auth: client.auth, calls }
}

describe("signInStaff", () => {
  it("refuses a wrong password", async () => {
    const { client } = fakeSupabase({
      signInError: { message: "Invalid login credentials", code: "invalid_credentials" },
    })

    expect(await signInStaff(client, "manager@example.test", "wrong")).toEqual({
      ok: false,
      error: "invalid-credentials",
    })
  })

  it("reports an outage as unavailable rather than blaming the password", async () => {
    const { client } = fakeSupabase({
      signInError: { message: "request failed", code: "over_request_rate_limit" },
    })

    expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "unavailable",
    })
  })

  it("signs in an active staff member with their role and permissions, and keeps the session", async () => {
    const { client, signOut } = fakeSupabase()

    expect(await signInStaff(client, "manager@example.test", "fixture-password")).toEqual({
      ok: true,
      data: MANAGER,
    })
    expect(signOut).not.toHaveBeenCalled()
  })

  it("refuses an account with no staff record and ends the session", async () => {
    const { client, signOut } = fakeSupabase({ staffRecord: { data: null, error: null } })

    expect(await signInStaff(client, "someone@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "not-staff",
    })
    expect(signOut).toHaveBeenCalled()
  })

  it("refuses a deactivated staff member and ends the session", async () => {
    const { client, signOut } = fakeSupabase({
      staffRecord: { data: { ...MANAGER_ROW, active: false, permissions: [] }, error: null },
    })

    expect(await signInStaff(client, "deactivated@example.test", "fixture-password")).toEqual({
      ok: false,
      error: "deactivated",
    })
    expect(signOut).toHaveBeenCalled()
  })

  it("refuses and ends the session when the staff record cannot be read", async () => {
    const { client, signOut } = fakeSupabase({
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
    const { client, signOut, rpc } = fakeSupabase({
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
    const { client, signOut, rpc } = fakeSupabase({ staffRecords: [ISSUED_AT_FUTURE, ISSUED_AT_FUTURE] })

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
  it("uses the invite token, sets the password, then checks the staff record", async () => {
    const { client, auth, calls, signOut } = fakeSupabase()

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: true, data: MANAGER })
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "invite" })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "a-new-password" })
    expect(calls).toEqual(["verifyOtp", "updateUser", "current_staff_member"])
    expect(signOut).not.toHaveBeenCalled()
  })

  it("refuses a short password without touching the token", async () => {
    const { client, calls } = fakeSupabase()

    expect(await acceptInvite(client, "hash-1", "short")).toEqual({ ok: false, error: "password-too-short" })
    expect(calls).toEqual([])
  })

  it("reports an expired or used link", async () => {
    const { client, calls } = fakeSupabase({
      verifyError: { message: "Email link is invalid or has expired", code: "otp_expired", status: 403 },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "invalid-link" })
    expect(calls).toEqual(["verifyOtp"])
  })

  it("reports an outage while checking the link as unavailable, so the person can try again", async () => {
    const { client } = fakeSupabase({ verifyError: { message: "fetch failed", status: 0 } })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "unavailable" })
  })

  it("signs out someone deactivated before accepting, keeping the password for if they are reactivated", async () => {
    const { client, calls, signOut } = fakeSupabase({
      staffRecord: { data: { ...MANAGER_ROW, active: false, permissions: [] }, error: null },
    })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "deactivated" })
    expect(calls).toEqual(["verifyOtp", "updateUser", "current_staff_member"])
    expect(signOut).toHaveBeenCalled()
  })

  it("keeps the session when the password can't be saved, and names the account the token verified", async () => {
    const { client, signOut, calls, auth } = fakeSupabase({ updateError: { message: "boom", status: 500 } })

    expect(await acceptInvite(client, "hash-1", "a-new-password")).toEqual({
      ok: false,
      error: "password-not-saved",
      userId: "invitee",
    })
    // Taken from the verification itself, so no further call can fail first.
    expect(auth.getUser).not.toHaveBeenCalled()
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
    expect(calls).toEqual(["updateUser", "current_staff_member"])
  })

  it("refuses a retry when someone else is signed in, and changes nobody's password", async () => {
    const { client, calls } = fakeSupabase()

    expect(await acceptInvite(client, "hash-1", "a-new-password", { verifiedUserId: "the-invitee" })).toEqual({
      ok: false,
      error: "invalid-link",
    })
    expect(calls).toEqual([])
  })

  it("treats a retry with no session left as a spent link", async () => {
    const { client, calls } = fakeSupabase({ sessionUser: false })

    expect(await acceptInvite(client, "hash-1", "a-new-password", { verifiedUserId: "user" })).toEqual({
      ok: false,
      error: "invalid-link",
    })
    expect(calls).toEqual([])
  })
})
