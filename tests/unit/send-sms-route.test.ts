import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
// The route finishes a slow send after its answer; outside Next.js, now.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), after: (work: () => unknown) => void work() }))

const sendAuthSms = vi.fn()
vi.mock("@/lib/services/auth-sms", () => ({ sendAuthSms: (...args: unknown[]) => sendAuthSms(...args) }))
vi.mock("@/utils/supabase/sms", () => ({ smsClient: () => ({}) }))

import { POST } from "@/app/api/auth/send-sms/route"
import { signWebhook } from "@/lib/standard-webhooks"

// What the Send SMS hook answers Supabase (#503 slice 2b): 200 whenever the
// number should stay usable or nothing was meant to go out, 400 for a failed
// send, 401 for a bad signature; never a status Supabase retries.

const SECRET = "v1,whsec_dGVzdC1zZWNyZXQtZm9yLWhvb2tzLW9ubHk="

function signed(body: unknown, secret = SECRET) {
  const text = JSON.stringify(body)
  const timestamp = Math.floor(Date.now() / 1000)
  return new Request("http://localhost/api/auth/send-sms", {
    method: "POST",
    headers: { "webhook-id": "msg_1", "webhook-timestamp": String(timestamp), "webhook-signature": signWebhook(secret, "msg_1", timestamp, text) },
    body: text,
  })
}

const BODY = { user: { id: "6f1c2c1e-1b2d-4c3e-9f4a-5b6c7d8e9f01", phone: "255712345123" }, sms: { otp: "739204" } }

beforeEach(() => {
  process.env.SEND_SMS_HOOK_SECRET = SECRET
  sendAuthSms.mockReset()
})

describe("the Send SMS hook's answers", () => {
  it("refuses a bad signature without looking anything up", async () => {
    const response = await POST(signed(BODY, "v1,whsec_b3RoZXItc2VjcmV0LWZvci1ob29rcy1vbmx5"))
    expect(response.status).toBe(401)
    expect(sendAuthSms).not.toHaveBeenCalled()
  })

  it("answers 200 for a sent SMS and for one deliberately not sent", async () => {
    for (const answer of [
      { ok: true, data: { sendId: "s1" } },
      { ok: false, error: "phone-change" },
      { ok: false, error: "not-agent" },
    ]) {
      sendAuthSms.mockResolvedValueOnce(answer)
      const response = await POST(signed(BODY))
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({})
    }
  })

  it("answers 200 when Beem timed out, so Supabase keeps a number Beem may still deliver", async () => {
    sendAuthSms.mockResolvedValueOnce({ ok: false, error: { kind: "provider-error", code: "timeout" } })
    expect((await POST(signed(BODY))).status).toBe(200)
  })

  it("answers 200 when a send already with Beem runs past 3.5 seconds, and lets it finish", async () => {
    vi.useFakeTimers()
    let finish: (value: unknown) => void = () => {}
    sendAuthSms.mockImplementationOnce((_client, _send, _request, _words, gate: { reserved: boolean }) => {
      gate.reserved = true
      return new Promise((resolve) => (finish = resolve))
    })
    const answering = POST(signed(BODY))
    await vi.advanceTimersByTimeAsync(4_100)
    expect((await answering).status).toBe(200)
    finish({ ok: true, data: { sendId: "s1" } })
    vi.useRealTimers()
  })

  it("answers 400 and abandons a send with no place reserved by 3.5 seconds, so Supabase keeps the earlier number", async () => {
    vi.useFakeTimers()
    let finish: (value: unknown) => void = () => {}
    let seen: { reserved: boolean; abandoned: boolean } | undefined
    sendAuthSms.mockImplementationOnce((_client, _send, _request, _words, gate: { reserved: boolean; abandoned: boolean }) => {
      seen = gate
      return new Promise((resolve) => (finish = resolve))
    })
    const answering = POST(signed(BODY))
    await vi.advanceTimersByTimeAsync(4_100)
    expect((await answering).status).toBe(400)
    expect(seen?.abandoned).toBe(true)
    finish({ ok: false, error: { kind: "mobile-limited" } })
    vi.useRealTimers()
  })

  it("answers 400 for a send that failed, never a status Supabase retries", async () => {
    for (const error of [{ kind: "budget-reached" }, { kind: "mobile-limited" }, { kind: "provider-error", code: "network" }, { kind: "unavailable" }]) {
      sendAuthSms.mockResolvedValueOnce({ ok: false, error })
      expect((await POST(signed(BODY))).status).toBe(400)
    }
  })
})
