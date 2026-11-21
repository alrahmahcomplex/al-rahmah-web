import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { beemSender, fakeSender, smsSender } from "@/lib/services/sms"

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

  test("a network failure and a timeout are told apart", async () => {
    const down = beemSender(KEYS, vi.fn(async () => { throw new TypeError("fetch failed") }) as unknown as typeof fetch)
    await expect(down("255712345123", "x")).resolves.toEqual({ ok: false, error: "network" })

    const slow = beemSender(KEYS, vi.fn(async () => { throw new DOMException("timed out", "TimeoutError") }) as unknown as typeof fetch)
    await expect(slow("255712345123", "x")).resolves.toEqual({ ok: false, error: "timeout" })
  })
})

describe("smsSender", () => {
  test("without the keys outside Production, the fake sends nothing and logs it", async () => {
    const lines: string[] = []
    const send = fakeSender((line) => lines.push(line))
    await expect(send("255712345123", "Namba yako ni 482913")).resolves.toEqual({ ok: true, data: { requestId: "fake-1" } })
    expect(lines).toEqual(["[fake SMS 1] to 255712345123: Namba yako ni 482913"])
  })

  test("without the keys in Production, every send fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const send = smsSender({ VERCEL_ENV: "production" })
    await expect(send("255712345123", "x")).resolves.toEqual({ ok: false, error: "beem_keys_missing" })
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
