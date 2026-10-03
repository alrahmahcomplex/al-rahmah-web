import { describe, expect, it } from "vitest"

import {
  agentRegistrationProblem,
  parseAgentRegistration,
  referralLink,
  requestOrigin,
  whatsappShareLink,
} from "@/lib/agent-registration"

function posted(fields: Record<string, string>) {
  const data = new FormData()
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

describe("reading the Discount code registration", () => {
  it("trims the entries, collapses spaces in the name, and leaves an empty WhatsApp out", () => {
    expect(parseAgentRegistration(posted({ full_name: "  Rehema   Juma ", phone: " 0712 345 678 ", whatsapp: "  " }))).toEqual({
      ok: true,
      data: { fullName: "Rehema Juma", phone: "0712 345 678", whatsapp: null },
    })
  })

  it("keeps a WhatsApp number as typed", () => {
    const parsed = parseAgentRegistration(posted({ full_name: "Rehema Juma", phone: "0712345678", whatsapp: "+255 754 000 111" }))
    expect(parsed).toEqual({ ok: true, data: { fullName: "Rehema Juma", phone: "0712345678", whatsapp: "+255 754 000 111" } })
  })

  it.each([
    ["an empty name", { full_name: "   ", phone: "0712345678" }, "full_name"],
    ["a one-letter name", { full_name: " R ", phone: "0712345678" }, "full_name"],
    ["a name over 100 characters", { full_name: "A".repeat(101), phone: "0712345678" }, "full_name"],
    ["no phone", { full_name: "Rehema Juma", phone: "  " }, "phone"],
    ["a phone too long to be one", { full_name: "Rehema Juma", phone: "0".repeat(41) }, "phone"],
    ["a WhatsApp too long to be one", { full_name: "Rehema Juma", phone: "0712345678", whatsapp: "0".repeat(41) }, "whatsapp"],
  ])("refuses %s, naming the field", (_, fields, field) => {
    expect(parseAgentRegistration(posted(fields))).toEqual({ ok: false, error: field })
  })

  it("accepts names of exactly 2 and 100 characters, counting letters, not code units", () => {
    expect(parseAgentRegistration(posted({ full_name: "Jo", phone: "0712345678" })).ok).toBe(true)
    expect(parseAgentRegistration(posted({ full_name: "É".repeat(100), phone: "0712345678" })).ok).toBe(true)
  })

  it("treats a missing field as empty", () => {
    expect(parseAgentRegistration(new FormData())).toEqual({ ok: false, error: "full_name" })
  })

  it("checks a draft the same way on the page", () => {
    expect(agentRegistrationProblem({ fullName: "Rehema", phone: "", whatsapp: "" })).toBe("phone")
    expect(agentRegistrationProblem({ fullName: "Rehema", phone: "0712345678", whatsapp: "" })).toBeNull()
  })
})

describe("the Referral link", () => {
  it("is /apply?ref=<code> on the request's own origin", () => {
    expect(referralLink("https://al-rahmah-web-git-x.vercel.app", "AJM-407")).toBe(
      "https://al-rahmah-web-git-x.vercel.app/apply?ref=AJM-407",
    )
  })

  it("takes the origin from the forwarded host and protocol", () => {
    const headers = new Headers({ host: "internal:3000", "x-forwarded-host": "alrahmah.example", "x-forwarded-proto": "https" })
    expect(requestOrigin(headers)).toBe("https://alrahmah.example")
  })

  it("falls back to the host header, over http only for a local host", () => {
    expect(requestOrigin(new Headers({ host: "localhost:3282" }))).toBe("http://localhost:3282")
    expect(requestOrigin(new Headers({ host: "127.0.0.1:3100" }))).toBe("http://127.0.0.1:3100")
    expect(requestOrigin(new Headers({ host: "alrahmah.example" }))).toBe("https://alrahmah.example")
  })

  it("uses the first of several forwarded values", () => {
    const headers = new Headers({ "x-forwarded-host": "a.example, b.example", "x-forwarded-proto": "https,http" })
    expect(requestOrigin(headers)).toBe("https://a.example")
  })

  it.each(["", "evil.example/path", "a b", "evil.example@x", "javascript:alert(1)"])("refuses the unusable host %j", (host) => {
    expect(requestOrigin(new Headers(host ? { host } : {}))).toBeNull()
  })
})

describe("Share on WhatsApp", () => {
  it("is a wa.me link with no recipient, the text encoded whole", () => {
    const link = whatsappShareLink("Code AJM-407 + punguzo: https://x.example/apply?ref=AJM-407")
    expect(link).toBe(
      "https://wa.me/?text=Code%20AJM-407%20%2B%20punguzo%3A%20https%3A%2F%2Fx.example%2Fapply%3Fref%3DAJM-407",
    )
    expect(decodeURIComponent(new URL(link).search.slice("?text=".length))).toBe(
      "Code AJM-407 + punguzo: https://x.example/apply?ref=AJM-407",
    )
  })
})
