import { describe, expect, it } from "vitest"

import { signWebhook, verifyWebhook } from "@/lib/standard-webhooks"

// The Send SMS hook's signature check (#503): Standard Webhooks, as Supabase
// Auth signs its hooks. An example secret, not a real one.

const SECRET = "v1,whsec_dGVzdC1zZWNyZXQtZm9yLWhvb2tzLW9ubHk="
const OTHER = "v1,whsec_b3RoZXItc2VjcmV0LWZvci1ob29rcy1vbmx5"
const BODY = JSON.stringify({ user: { id: "u1", phone: "255712345123" }, sms: { otp: "123456" } })
const NOW = 1_800_000_000

function headersFor(secret = SECRET, timestamp = NOW, body = BODY, id = "msg_1") {
  return { id, timestamp: String(timestamp), signature: signWebhook(secret, id, timestamp, body) }
}

describe("verifyWebhook", () => {
  it("accepts a request signed with the secret", () => {
    expect(verifyWebhook(SECRET, headersFor(), BODY, NOW)).toBe(true)
  })

  it("accepts the secret without its v1, prefix too", () => {
    expect(verifyWebhook(SECRET.slice(3), headersFor(), BODY, NOW)).toBe(true)
  })

  it("accepts any matching signature in a list", () => {
    const signed = headersFor()
    expect(verifyWebhook(SECRET, { ...signed, signature: `v1,bm90LWl0 ${signed.signature}` }, BODY, NOW)).toBe(true)
  })

  it("refuses another secret, a changed body, a changed id and a missing header", () => {
    expect(verifyWebhook(SECRET, headersFor(OTHER), BODY, NOW)).toBe(false)
    expect(verifyWebhook(SECRET, headersFor(), BODY.replace("123456", "654321"), NOW)).toBe(false)
    expect(verifyWebhook(SECRET, { ...headersFor(), id: "msg_2" }, BODY, NOW)).toBe(false)
    expect(verifyWebhook(SECRET, { ...headersFor(), signature: null }, BODY, NOW)).toBe(false)
    expect(verifyWebhook(SECRET, { ...headersFor(), timestamp: null }, BODY, NOW)).toBe(false)
  })

  it("refuses a request more than five minutes old or ahead", () => {
    expect(verifyWebhook(SECRET, headersFor(SECRET, NOW - 301), BODY, NOW)).toBe(false)
    expect(verifyWebhook(SECRET, headersFor(SECRET, NOW + 301), BODY, NOW)).toBe(false)
    expect(verifyWebhook(SECRET, headersFor(SECRET, NOW - 299), BODY, NOW)).toBe(true)
  })

  it("refuses everything when the secret is missing or not a secret", () => {
    expect(verifyWebhook(undefined, headersFor(), BODY, NOW)).toBe(false)
    expect(verifyWebhook("", headersFor(), BODY, NOW)).toBe(false)
    expect(verifyWebhook("v1,whsec_", headersFor(), BODY, NOW)).toBe(false)
  })

  it("refuses a signature of another version", () => {
    const signed = headersFor()
    expect(verifyWebhook(SECRET, { ...signed, signature: signed.signature.replace(/^v1,/, "v2,") }, BODY, NOW)).toBe(false)
  })
})
