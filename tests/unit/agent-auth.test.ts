import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

import { acceptAgentInvite, getAgentUser } from "@/lib/services/agent-auth"

type Answer = { data: unknown; error: { message: string; code?: string } | null }

const ACTIVE: Answer = { data: { state: "active", full_name: "Neema Juma", code: "NEEMA-01" }, error: null }

// A stand-in for the Supabase SDK. The browser has a session once signed in
// or once a link is used, or from the start with `startedAs`, which also
// picks who the one-account check finds.
function fakeSupabase({
  startedAs = null as "staff" | "agent" | null,
  account = ACTIVE,
  signInError = null as { message: string; code?: string; status?: number } | null,
  verifyError = null as { message: string; status?: number } | null,
  // Successive answers before `account` / the staff check's usual answer.
  accountAnswers = [] as Answer[],
  staffAnswers = [] as Answer[],
} = {}) {
  let session: "staff" | "agent" | null = startedAs
  const calls: string[] = []
  const signOut = vi.fn(async () => {
    session = null
    return { error: null }
  })
  const client = {
    auth: {
      getUser: vi.fn(async () =>
        session ? { data: { user: { id: "user" } }, error: null } : { data: { user: null }, error: { message: "Auth session missing!", status: 400 } },
      ),
      signInWithPassword: vi.fn(async () => {
        calls.push("signInWithPassword")
        if (!signInError) session = "agent"
        return { data: {}, error: signInError }
      }),
      verifyOtp: vi.fn(async () => {
        calls.push("verifyOtp")
        if (verifyError) return { data: { user: null }, error: verifyError }
        session = "agent"
        return { data: { user: { id: "user" } }, error: null }
      }),
      updateUser: vi.fn(async () => {
        calls.push("updateUser")
        return { data: {}, error: null }
      }),
      signOut,
    },
    rpc: vi.fn((fn: string) => ({
      maybeSingle: vi.fn(async () => {
        if (fn === "current_staff_member") {
          return staffAnswers.shift() ?? { data: session === "staff" ? { id: "staff" } : null, error: null }
        }
        if (fn === "current_agent_account") {
          const next = accountAnswers.shift()
          if (next) return next
          return session === "agent" ? account : { data: null, error: null }
        }
        return { data: null, error: null }
      }),
    })),
  }
  return { client: client as unknown as SupabaseClient, auth: client.auth, rpc: client.rpc, signOut, calls }
}

describe("acceptAgentInvite", () => {
  it("uses the link, sets the password and lands the agent signed in", async () => {
    const { client, calls, auth } = fakeSupabase()

    expect(await acceptAgentInvite(client, "hash-1", "a-new-password")).toEqual({
      ok: true,
      data: { fullName: "Neema Juma", code: "NEEMA-01" },
    })
    expect(auth.verifyOtp).toHaveBeenCalledWith({ token_hash: "hash-1", type: "invite" })
    expect(calls).toEqual(["verifyOtp", "updateUser"])
  })

  it("refuses while staff are signed in, leaving the link unused", async () => {
    const { client, calls } = fakeSupabase({ startedAs: "staff" })

    expect(await acceptAgentInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "staff-session" })
    expect(calls).toEqual([])
  })

  it("keeps the password but signs out an agent switched off before accepting", async () => {
    const { client, calls, signOut } = fakeSupabase({
      account: { data: { state: "switched_off", full_name: null, code: null }, error: null },
    })

    expect(await acceptAgentInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "switched-off" })
    expect(calls).toEqual(["verifyOtp", "updateUser"])
    expect(signOut).toHaveBeenCalled()
  })

  it("reports an expired or used link", async () => {
    const { client } = fakeSupabase({ verifyError: { message: "Email link is invalid or has expired", status: 403 } })

    expect(await acceptAgentInvite(client, "hash-1", "a-new-password")).toEqual({ ok: false, error: "invalid-link" })
  })
})

describe("getAgentUser", () => {
  it("reads the signed-in agent afresh, so a switch-off applies at once", async () => {
    const { client } = fakeSupabase({
      startedAs: "agent",
      account: { data: { state: "switched_off", full_name: null, code: null }, error: null },
    })

    expect(await getAgentUser(client)).toEqual({ ok: false, error: "switched-off" })
  })

  it("is signed out with no session", async () => {
    expect(await getAgentUser(fakeSupabase().client)).toEqual({ ok: false, error: "signed-out" })
  })
})

// What PostgREST answers when its clock lags behind the token's issue time.
const ISSUED_AT_FUTURE: Answer = { data: null, error: { code: "PGRST303", message: "JWT issued at future" } }

describe("a token PostgREST's clock thinks is from the future", () => {
  async function withTimersRunning<T>(pending: Promise<T>) {
    await vi.runAllTimersAsync()
    return pending
  }

  it("reads the agent once a second read is accepted", async () => {
    vi.useFakeTimers()
    try {
      const { client, signOut } = fakeSupabase({ startedAs: "agent", accountAnswers: [ISSUED_AT_FUTURE] })

      expect(await withTimersRunning(getAgentUser(client))).toEqual({
        ok: true,
        data: { fullName: "Neema Juma", code: "NEEMA-01" },
      })
      expect(signOut).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("reads the agent again only once, and fails closed if the clock still lags", async () => {
    vi.useFakeTimers()
    try {
      const { client, signOut } = fakeSupabase({ startedAs: "agent", accountAnswers: [ISSUED_AT_FUTURE, ISSUED_AT_FUTURE] })

      expect(await withTimersRunning(getAgentUser(client))).toEqual({ ok: false, error: "unavailable" })
      expect(signOut).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it("retries the one-account check's reads before deciding who is signed in", async () => {
    vi.useFakeTimers()
    try {
      // The browser holds an agent session; the staff read lags first.
      const { client, calls } = fakeSupabase({ startedAs: "agent", staffAnswers: [ISSUED_AT_FUTURE], accountAnswers: [ISSUED_AT_FUTURE] })

      expect(await withTimersRunning(acceptAgentInvite(client, "hash-1", "a-new-password"))).toEqual({
        ok: true,
        data: { fullName: "Neema Juma", code: "NEEMA-01" },
      })
      expect(calls).toEqual(["verifyOtp", "updateUser"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("does not read again after any other failure", async () => {
    const { client, rpc } = fakeSupabase({
      startedAs: "agent",
      accountAnswers: [{ data: null, error: { code: "PGRST303", message: "JWT expired" } }],
    })

    expect(await getAgentUser(client)).toEqual({ ok: false, error: "unavailable" })
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
