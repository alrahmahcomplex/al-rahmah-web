import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { sendAuthSms } from "@/lib/services/auth-sms"
import { checkResetNumber, requestResetSms, saveResetPassword } from "@/lib/services/sms-reset"

import { resetSms } from "@/app/api/auth/send-sms/words"
import { fitsOneSms } from "@/lib/services/sms"

// The reset by SMS (#503 slice 2b) against fakes: what Supabase is asked,
// how its answers are read, and who the Send SMS hook texts.

type AuthError = { code?: string; status?: number; message?: string }

function authClient({
  otpError = null as AuthError | null,
  verifyError = null as AuthError | null,
  agent = { state: "active", full_name: "Neema Simu Juma", code: "NSJ-101" } as Record<string, unknown> | null,
  updateError = null as AuthError | null,
} = {}) {
  const signedIn = { value: false }
  const auth = {
    signInWithOtp: vi.fn(async () => ({ data: {}, error: otpError })),
    verifyOtp: vi.fn(async () => {
      if (verifyError) return { data: { user: null, session: null }, error: verifyError }
      signedIn.value = true
      return { data: { user: { id: "user-1" }, session: {} }, error: null }
    }),
    getClaims: vi.fn(async () => (signedIn.value ? { data: { claims: { sub: "user-1" } }, error: null } : { data: null, error: null })),
    signOut: vi.fn(async () => {
      signedIn.value = false
      return { error: null }
    }),
    updateUser: vi.fn(async () => ({ data: {}, error: updateError })),
  }
  const rpc = vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: agent, error: null })) }))
  return { client: { auth, rpc } as unknown as SupabaseClient, auth, signedIn }
}

describe("asking for a reset SMS", () => {
  it("asks Supabase never to make a login, with the Turnstile token, as 255 and nine digits", async () => {
    const { client, auth } = authClient()
    expect(await requestResetSms(client, "+255712345123", "token")).toEqual({ ok: true, data: null })
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ phone: "255712345123", options: { shouldCreateUser: false, captchaToken: "token" } })
  })

  it.each(["otp_disabled", "signup_disabled", "user_not_found", "over_sms_send_rate_limit", "sms_send_failed", "hook_timeout"])(
    "answers %s as sent, so the reply never tells whether the number has an account",
    async (code) => {
      const { client } = authClient({ otpError: { code, status: 422 } })
      expect(await requestResetSms(client, "+255712345123", "token")).toEqual({ ok: true, data: null })
    },
  )

  it("says the security check failed when Supabase refuses the token", async () => {
    const { client } = authClient({ otpError: { code: "captcha_failed", status: 400 } })
    expect(await requestResetSms(client, "+255712345123", "token")).toEqual({ ok: false, error: "check-failed" })
  })
})

describe("checking the number", () => {
  it("signs an agent in with a right number", async () => {
    const { client, auth } = authClient()
    expect(await checkResetNumber(client, "+255712345123", "246810")).toEqual({ ok: true, data: { userId: "user-1" } })
    expect(auth.verifyOtp).toHaveBeenCalledWith({ phone: "255712345123", token: "246810", type: "sms" })
    expect(auth.signOut).not.toHaveBeenCalled()
  })

  it("reads a refused number as wrong, and asks Supabase nothing for one that isn't six digits", async () => {
    const { client, auth } = authClient({ verifyError: { code: "otp_expired", status: 403 } })
    expect(await checkResetNumber(client, "+255712345123", "000000")).toEqual({ ok: false, error: "wrong-number" })
    expect(await checkResetNumber(client, "+255712345123", "12345")).toEqual({ ok: false, error: "wrong-number" })
    expect(auth.verifyOtp).toHaveBeenCalledTimes(1)
  })

  it("says too many tries when Supabase limits the checks", async () => {
    const { client } = authClient({ verifyError: { code: "over_request_rate_limit", status: 429 } })
    expect(await checkResetNumber(client, "+255712345123", "000000")).toEqual({ ok: false, error: "rate-limited" })
  })

  it("ends the session at once for a login that isn't an agent's, or a switched-off agent", async () => {
    const none = authClient({ agent: null })
    expect(await checkResetNumber(none.client, "+255712345123", "246810")).toEqual({ ok: false, error: "no-account" })
    expect(none.auth.signOut).toHaveBeenCalledWith({ scope: "local" })

    const off = authClient({ agent: { state: "switched_off", full_name: null, code: null } })
    expect(await checkResetNumber(off.client, "+255712345123", "246810")).toEqual({ ok: false, error: "switched-off" })
    expect(off.signedIn.value).toBe(false)
  })
})

describe("saving the new password", () => {
  it("saves it on the session the number gave", async () => {
    const { client, auth, signedIn } = authClient()
    signedIn.value = true
    expect(await saveResetPassword(client, "new-password", "user-1")).toEqual({ ok: true, data: null })
    expect(auth.updateUser).toHaveBeenCalledWith({ password: "new-password" })
  })

  it("saves nothing when the browser's session is no longer the login the number proved", async () => {
    const { client, auth, signedIn } = authClient()
    signedIn.value = true
    expect(await saveResetPassword(client, "new-password", "someone-else")).toEqual({ ok: false, error: "signed-out" })
    expect(await saveResetPassword(client, "new-password", null)).toEqual({ ok: false, error: "signed-out" })
    expect(auth.updateUser).not.toHaveBeenCalled()
  })

  it("refuses a short password, no session, and an agent switched off since", async () => {
    const short = authClient()
    short.signedIn.value = true
    expect(await saveResetPassword(short.client, "abc", "user-1")).toEqual({ ok: false, error: "password-too-short" })

    expect(await saveResetPassword(authClient().client, "new-password", "user-1")).toEqual({ ok: false, error: "signed-out" })

    const off = authClient({ agent: { state: "switched_off", full_name: null, code: null } })
    off.signedIn.value = true
    expect(await saveResetPassword(off.client, "new-password", "user-1")).toEqual({ ok: false, error: "switched-off" })
    expect(off.auth.updateUser).not.toHaveBeenCalled()
  })
})

describe("the Send SMS hook's choice", () => {
  const ACTIVE = { id: "agent-1", status: "Approved", switched_off_at: null, retired_at: null }
  function hookClient(agent: Record<string, unknown> | null, accessOn = true) {
    const maybeSingle = vi.fn(async () => ({ data: agent, error: null }))
    const eq = vi.fn(() => ({ maybeSingle }))
    const access = { maybeSingle: vi.fn(async () => ({ data: { enabled: accessOn }, error: null })) }
    const from = vi.fn((table: string) => ({ select: vi.fn(() => (table === "agent_access_settings" ? access : { eq })) }))
    const rpc = vi.fn(async (fn: string) =>
      fn === "reserve_sms" ? { data: { outcome: "reserved", send_id: "send-1" }, error: null } : { data: null, error: null },
    )
    return { client: { from, rpc } as unknown as SupabaseClient, eq, rpc }
  }
  const request = (user: Record<string, unknown>) => ({ user: { id: "user-1", phone: "255712345123", ...user }, sms: { otp: "739204" } })

  it("texts an agent's login our words at the mobile Auth holds", async () => {
    const { client, eq } = hookClient(ACTIVE)
    const send = vi.fn(async () => ({ ok: true as const, data: { requestId: "r1" } }))
    expect(await sendAuthSms(client, send, request({}), resetSms)).toEqual({ ok: true, data: { sendId: "send-1" } })
    expect(eq).toHaveBeenCalledWith("user_id", "user-1")
    expect(send).toHaveBeenCalledWith("255712345123", resetSms("739204"))
  })

  it("texts nothing for a phone change, whoever asks", async () => {
    const { client, rpc } = hookClient(ACTIVE)
    const send = vi.fn()
    expect(await sendAuthSms(client, send, request({ phone_change: "255799111222" }), resetSms)).toEqual({ ok: false, error: "phone-change" })
    expect(send).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["switched off", { ...ACTIVE, switched_off_at: "2026-11-01T00:00:00Z" }, true],
    ["retired", { ...ACTIVE, retired_at: "2026-11-01T00:00:00Z" }, true],
    ["not Approved", { ...ACTIVE, status: "Pending" }, true],
    ["with agent access off", ACTIVE, false],
  ])("texts nothing to an agent %s: a session would be theirs for the number", async (_label, agent, accessOn) => {
    const { client } = hookClient(agent, accessOn as boolean)
    const send = vi.fn()
    expect(await sendAuthSms(client, send, request({}), resetSms)).toEqual({ ok: false, error: "not-active" })
    expect(send).not.toHaveBeenCalled()
  })

  it("texts nothing to a login that isn't an agent's", async () => {
    const { client } = hookClient(null)
    const send = vi.fn()
    expect(await sendAuthSms(client, send, request({}), resetSms)).toEqual({ ok: false, error: "not-agent" })
    expect(send).not.toHaveBeenCalled()
  })

  it("refuses a request without a six-digit number or a mobile", async () => {
    const { client } = hookClient(ACTIVE)
    const send = vi.fn()
    expect(await sendAuthSms(client, send, { user: { id: "user-1", phone: "255712345123" }, sms: { otp: "12" } }, resetSms)).toEqual({ ok: false, error: "invalid" })
    expect(await sendAuthSms(client, send, request({ phone: "" }), resetSms)).toEqual({ ok: false, error: "invalid" })
    expect(send).not.toHaveBeenCalled()
  })

  it("keeps the reset SMS to one segment", () => {
    expect(fitsOneSms(resetSms("739204"))).toBe(true)
  })
})
