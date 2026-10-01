import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { verifyTurnstile } from "@/lib/turnstile"

const REAL_SECRET = "0x4AAAAAAAreal-secret-for-tests"
const TEST_SECRET = "1x0000000000000000000000000000000AA"
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify"

const INPUT = {
  token: "a-turnstile-token",
  action: "admission",
  remoteIp: "198.51.100.7",
  hostname: "alrahmah.example",
}

function answer(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

const PASSED = {
  success: true,
  "error-codes": [],
  challenge_ts: "2026-10-01T10:00:00.000Z",
  hostname: "alrahmah.example",
  action: "admission",
}

// What siteverify answered the always-pass test secret on 2026-10-01: no
// action, and a fixed hostname.
const TEST_KEY_PASSED = {
  success: true,
  "error-codes": [],
  challenge_ts: "2026-10-01T13:43:55.461Z",
  hostname: "example.com",
  metadata: { result_with_testing_key: true },
}

const fetchMock = vi.fn<typeof fetch>()

function sentBody(call: number) {
  const init = fetchMock.mock.calls[call][1]
  return JSON.parse(String(init?.body)) as Record<string, string>
}

beforeEach(() => {
  vi.stubEnv("TURNSTILE_SECRET_KEY", REAL_SECRET)
  vi.stubGlobal("fetch", fetchMock)
  vi.spyOn(console, "error").mockImplementation(() => {})
  vi.spyOn(console, "warn").mockImplementation(() => {})
})

afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("verifyTurnstile", () => {
  it("passes a token Cloudflare accepts for this action and host", async () => {
    fetchMock.mockResolvedValueOnce(answer(PASSED))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: true, data: null })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(SITEVERIFY)
    expect(init?.method).toBe("POST")
    const body = sentBody(0)
    expect(body.secret).toBe(REAL_SECRET)
    expect(body.response).toBe("a-turnstile-token")
    expect(body.remoteip).toBe("198.51.100.7")
    expect(body.idempotency_key).toMatch(/^[0-9a-f-]{36}$/)
  })

  it("compares the hostname without the request's port", async () => {
    fetchMock.mockResolvedValueOnce(answer(PASSED))

    await expect(verifyTurnstile({ ...INPUT, hostname: "Alrahmah.Example:443" })).resolves.toEqual({
      ok: true,
      data: null,
    })
  })

  it("leaves remoteip out when the client IP is unknown", async () => {
    fetchMock.mockResolvedValueOnce(answer(PASSED))

    await verifyTurnstile({ ...INPUT, remoteIp: null })

    expect(sentBody(0)).not.toHaveProperty("remoteip")
  })

  it.each([null, undefined, "", "   "])("is missing when the token is %j, without calling Cloudflare", async (token) => {
    await expect(verifyTurnstile({ ...INPUT, token })).resolves.toEqual({ ok: false, error: "missing" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("is missing when the form sent something other than text", async () => {
    const file = new File(["x"], "token.txt")
    await expect(verifyTurnstile({ ...INPUT, token: file })).resolves.toEqual({ ok: false, error: "missing" })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("is missing when Cloudflare reports no token", async () => {
    fetchMock.mockResolvedValueOnce(answer({ success: false, "error-codes": ["missing-input-response"] }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "missing" })
  })

  it.each([
    ["a bad token", "invalid-input-response"],
    ["a reused or expired token", "timeout-or-duplicate"],
  ])("fails %s", async (_, code) => {
    fetchMock.mockResolvedValueOnce(answer({ success: false, "error-codes": [code] }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "failed" })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("fails a token longer than Cloudflare ever issues, without calling Cloudflare", async () => {
    await expect(verifyTurnstile({ ...INPUT, token: "x".repeat(2049) })).resolves.toEqual({
      ok: false,
      error: "failed",
    })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("fails a token issued for another form's action", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...PASSED, action: "agent" }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "failed" })
  })

  it("fails a token with no action when real keys are in use", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...PASSED, action: undefined }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "failed" })
  })

  it("fails a token solved on another hostname", async () => {
    fetchMock.mockResolvedValueOnce(answer({ ...PASSED, hostname: "copycat.example" }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "failed" })
  })

  it("fails when the request's host is unknown", async () => {
    fetchMock.mockResolvedValueOnce(answer(PASSED))

    await expect(verifyTurnstile({ ...INPUT, hostname: null })).resolves.toEqual({ ok: false, error: "failed" })
  })

  it("skips the hostname and action checks with Cloudflare's test secret", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_SECRET)
    fetchMock.mockResolvedValueOnce(answer(TEST_KEY_PASSED))

    await expect(verifyTurnstile({ ...INPUT, hostname: "localhost:3100" })).resolves.toEqual({
      ok: true,
      data: null,
    })
  })

  it("refuses the form and logs an error when Production runs on a test secret", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", TEST_SECRET)
    vi.stubEnv("VERCEL_ENV", "production")
    fetchMock.mockResolvedValueOnce(answer(TEST_KEY_PASSED))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "unavailable" })

    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("test secret"))
  })

  it("still rejects a failed token with Cloudflare's test secret", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "2x0000000000000000000000000000000AA")
    fetchMock.mockResolvedValueOnce(answer({ success: false, "error-codes": ["invalid-input-response"] }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "failed" })
  })

  it("retries a timed-out check once with the same idempotency key", async () => {
    fetchMock
      .mockRejectedValueOnce(new DOMException("The operation was aborted due to timeout", "TimeoutError"))
      .mockResolvedValueOnce(answer(PASSED))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: true, data: null })

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(sentBody(1).idempotency_key).toBe(sentBody(0).idempotency_key)
    expect(sentBody(1).response).toBe("a-turnstile-token")
  })

  it("gives each check a 5-second timeout", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout")
    fetchMock.mockResolvedValueOnce(answer(PASSED))

    await verifyTurnstile(INPUT)

    expect(timeout).toHaveBeenCalledWith(5000)
    expect(fetchMock.mock.calls[0][1]?.signal).toBe(timeout.mock.results[0].value)
  })

  it("retries once when Cloudflare reports an internal error", async () => {
    fetchMock
      .mockResolvedValueOnce(answer({ success: false, "error-codes": ["internal-error"] }))
      .mockResolvedValueOnce(answer(PASSED))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: true, data: null })
    expect(sentBody(1).idempotency_key).toBe(sentBody(0).idempotency_key)
  })

  it("fails closed as unavailable when both attempts time out", async () => {
    fetchMock.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "unavailable" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(console.error).toHaveBeenCalled()
  })

  it("fails closed as unavailable when Cloudflare answers with a server error twice", async () => {
    fetchMock.mockResolvedValue(new Response("Bad gateway", { status: 502 }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "unavailable" })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("fails closed as unavailable when the answer isn't JSON", async () => {
    fetchMock.mockResolvedValue(new Response("<html>", { status: 200 }))

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "unavailable" })
  })

  it.each(["missing-input-secret", "invalid-input-secret", "bad-request"])(
    "is unavailable, without a retry, when Cloudflare reports %s",
    async (code) => {
      fetchMock.mockResolvedValueOnce(answer({ success: false, "error-codes": [code] }))

      await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "unavailable" })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(console.error).toHaveBeenCalled()
    },
  )

  it("is unavailable when the secret isn't set, without calling Cloudflare", async () => {
    vi.stubEnv("TURNSTILE_SECRET_KEY", "")

    await expect(verifyTurnstile(INPUT)).resolves.toEqual({ ok: false, error: "unavailable" })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.error).toHaveBeenCalled()
  })
})
