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
  const LOGIN = "6f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f01"
  // auth_sms_agent answers the agent who may be texted now, or null.
  function hookClient(agentId: string | null) {
    const rpc = vi.fn(async (fn: string) => {
      if (fn === "auth_sms_agent") return { data: agentId, error: null }
      if (fn === "reserve_sms") return { data: { outcome: "reserved", send_id: "send-1" }, error: null }
      return { data: null, error: null }
    })
    return { client: { rpc } as unknown as SupabaseClient, rpc }
  }
  const request = (user: Record<string, unknown>) => ({ user: { id: LOGIN, phone: "255712345123", ...user }, sms: { otp: "739204" } })

  it("texts an agent's login our words at the mobile Auth holds", async () => {
    const { client, rpc } = hookClient("agent-1")
    const send = vi.fn(async () => ({ ok: true as const, data: { requestId: "r1" } }))
    expect(await sendAuthSms(client, send, request({}), resetSms)).toEqual({ ok: true, data: { sendId: "send-1" } })
    expect(rpc).toHaveBeenCalledWith("auth_sms_agent", { login: LOGIN })
    expect(send).toHaveBeenCalledWith("255712345123", resetSms("739204"))
  })

  it("texts nothing for a phone change, whoever asks", async () => {
    const { client, rpc } = hookClient("agent-1")
    const send = vi.fn()
    expect(await sendAuthSms(client, send, request({ phone_change: "255799111222" }), resetSms)).toEqual({ ok: false, error: "phone-change" })
    expect(send).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("texts nothing to a login with no agent who can use the pages now", async () => {
    const { client } = hookClient(null)
    const send = vi.fn()
    expect(await sendAuthSms(client, send, request({}), resetSms)).toEqual({ ok: false, error: "not-agent" })
    expect(send).not.toHaveBeenCalled()
  })

  it("refuses a request without a six-digit number, a login id or a mobile", async () => {
    const { client, rpc } = hookClient("agent-1")
    const send = vi.fn()
    expect(await sendAuthSms(client, send, { user: { id: LOGIN, phone: "255712345123" }, sms: { otp: "12" } }, resetSms)).toEqual({ ok: false, error: "invalid" })
    expect(await sendAuthSms(client, send, request({ id: "user-1" }), resetSms)).toEqual({ ok: false, error: "invalid" })
    expect(await sendAuthSms(client, send, request({ phone: "" }), resetSms)).toEqual({ ok: false, error: "invalid" })
    expect(send).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it("keeps the reset SMS to one segment", () => {
    expect(fitsOneSms(resetSms("739204"))).toBe(true)
  })
})
