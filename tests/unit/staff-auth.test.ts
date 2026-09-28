import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { getStaffUser, requirePermission, signInStaff } from "@/lib/services/staff-auth"

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

type StaffRecordResponse = { data: unknown; error: { message: string } | null }

// A stand-in for the Supabase SDK: the only boundary these tests fake.
// `staffRecord` is what `current_staff_member` answers.
function fakeSupabase({
  signInError = null as { message: string; code?: string } | null,
  staffRecord = { data: MANAGER_ROW, error: null } as StaffRecordResponse,
  sessionUser = true,
} = {}) {
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
    },
    rpc: vi.fn().mockReturnValue({ maybeSingle: vi.fn().mockResolvedValue(staffRecord) }),
  }
  return { client: client as unknown as SupabaseClient, signOut }
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
