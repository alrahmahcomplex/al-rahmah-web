import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { beemSender, fakeSender, fitsOneSms, gsm7Length, smsSender } from "@/lib/services/sms"

describe("one SMS, one segment", () => {
  test("160 plain characters fit; 161 don't", () => {
    expect(fitsOneSms("a".repeat(160))).toBe(true)
    expect(fitsOneSms("a".repeat(161))).toBe(false)
  })

  test("extension characters count two, and anything outside GSM-7 doesn't fit", () => {
    expect(gsm7Length("€[]")).toBe(6)
    expect(fitsOneSms(`${"a".repeat(158)}€`)).toBe(true)
    expect(fitsOneSms(`${"a".repeat(159)}€`)).toBe(false)
    expect(gsm7Length("Si wewe’")).toBeNull()
    expect(fitsOneSms("Namba ✓")).toBe(false)
    expect(fitsOneSms("   ")).toBe(false)
  })

  test("the owner's courtesy SMS fits", () => {
    expect(
      fitsOneSms("Akaunti yako ya Al-Rahmah imefunguliwa kwa amina.k@mfano.com. Si wewe? Piga ofisi 0777 000 111."),
    ).toBe(true)
  })
})

const KEYS = { apiKey: "key-1", secretKey: "secret-1", senderId: "AL-RAHMAH" }

function answering(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }))
}

describe("beemSender", () => {
  test("posts the message to Beem with basic auth and the sender name", async () => {
    const fetchMock = answering(200, { successful: true, code: 100, request_id: 4567, message: "Message Submitted Successfully" })
    const send = beemSender(KEYS, fetchMock as unknown as typeof fetch)

    await expect(send("255712345123", "Namba yako ni 482913")).resolves.toEqual({ ok: true, data: { requestId: "4567" } })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://apisms.beem.africa/v1/send")
    expect(init.method).toBe("POST")
    expect((init.headers as Record<string, string>).Authorization).toBe(`Basic ${Buffer.from("key-1:secret-1").toString("base64")}`)
    expect(JSON.parse(String(init.body))).toEqual({
      source_addr: "AL-RAHMAH",
      encoding: 0,
      message: "Namba yako ni 482913",
      recipients: [{ recipient_id: 1, dest_addr: "255712345123" }],
    })
  })

  test("a Beem refusal comes back with its code", async () => {
    const send = beemSender(KEYS, answering(400, { successful: false, code: 111, message: "Invalid Sender Id" }) as unknown as typeof fetch)
    await expect(send("255712345123", "x")).resolves.toEqual({ ok: false, error: "beem_111" })
  })

  test("an answer that isn't Beem's comes back with the HTTP status", async () => {
    const send = beemSender(KEYS, answering(502, "<html>Bad gateway</html>") as unknown as typeof fetch)
    await expect(send("255712345123", "x")).resolves.toEqual({ ok: false, error: "http_502" })
  })

  test("a timeout while reading Beem's answer is a timeout, not the 200 already received", async () => {
    const slowBody = vi.fn(async () => ({ ok: true, status: 200, json: async () => { throw new DOMException("timed out", "TimeoutError") } }))
    const send = beemSender(KEYS, slowBody as unknown as typeof fetch)
    await expect(send("255712345123", "x")).resolves.toEqual({ ok: false, error: "timeout" })

    const garbled = beemSender(KEYS, answering(200, "not json") as unknown as typeof fetch)
    await expect(garbled("255712345123", "x")).resolves.toEqual({ ok: false, error: "unreadable_answer" })
  })

  test("a network failure and a timeout are told apart", async () => {
    const down = beemSender(KEYS, vi.fn(async () => { throw new TypeError("fetch failed") }) as unknown as typeof fetch)
    await expect(down("255712345123", "x")).resolves.toEqual({ ok: false, error: "network" })

    const slow = beemSender(KEYS, vi.fn(async () => { throw new DOMException("timed out", "TimeoutError") }) as unknown as typeof fetch)
    await expect(slow("255712345123", "x")).resolves.toEqual({ ok: false, error: "timeout" })
  })
})

describe("Beem's answer must prove the message was taken", () => {
  test.each([
    ["no request id", { successful: true, code: 100, request_id: null }],
    ["an empty request id", { successful: true, code: 100, request_id: " " }],
    ["successful false", { successful: false, code: 100, request_id: 12 }],
  ])("code 100 with %s is not a send", async (_case, body) => {
    const send = beemSender(KEYS, answering(200, body) as unknown as typeof fetch)
    await expect(send("255712345123", "x")).resolves.toEqual({ ok: false, error: "unreadable_answer" })
  })
})

describe("smsSender", () => {
  test("the fake sends nothing and logs it", async () => {
    const lines: string[] = []
    const send = fakeSender((line) => lines.push(line))
    await expect(send("255712345123", "Namba yako ni 482913")).resolves.toEqual({ ok: true, data: { requestId: "fake-1" } })
    expect(lines).toEqual(["[fake SMS 1] to 255712345123: Namba yako ni 482913"])
  })

  test("without the keys it refuses every send unless the fake is asked for, and never fakes in Production", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const info = vi.spyOn(console, "info").mockImplementation(() => {})
    for (const env of [{}, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }, { SMS_FAKE: "1", VERCEL_ENV: "production" }, { SMS_FAKE: "true" }]) {
      await expect(smsSender(env)("255712345123", "x")).resolves.toEqual({ ok: false, error: "beem_keys_missing" })
    }
    await expect(smsSender({ SMS_FAKE: "1" })("255712345123", "x")).resolves.toEqual({ ok: true, data: { requestId: "fake-1" } })
    expect(info).toHaveBeenCalledTimes(1)
  })

  test("with all three keys it sends through Beem", async () => {
    const fetchMock = answering(200, { successful: true, code: 100, request_id: 1 })
    vi.stubGlobal("fetch", fetchMock)
    try {
      const send = smsSender({ BEEM_API_KEY: "k", BEEM_SECRET_KEY: "s", BEEM_SENDER_ID: "AL-RAHMAH", VERCEL_ENV: "preview" })
      await expect(send("255712345123", "x")).resolves.toEqual({ ok: true, data: { requestId: "1" } })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
