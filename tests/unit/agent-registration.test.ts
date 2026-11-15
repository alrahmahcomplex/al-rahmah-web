import { describe, expect, it } from "vitest"

import {
  agentCodePrefix,
  agentFullName,
  agentRegistrationProblem,
  parseAgentRegistration,
  referralLink,
  requestOrigin,
} from "@/lib/agent-registration"

function posted(fields: Record<string, string>) {
  const data = new FormData()
  data.set("email", "rehema@example.test")
  for (const [name, value] of Object.entries(fields)) data.set(name, value)
  return data
}

const NAMES = { firstName: "Rehema", middleName: "Ali", lastName: "Juma" }
const EMAIL = { email: "rehema@example.test", hasCode: false, code: null }

describe("reading the Discount code registration", () => {
  it("joins the three names in capitals, trims the entries, and leaves an empty WhatsApp out", () => {
    expect(
      parseAgentRegistration(posted({ firstName: "  rehema ", middleName: "ali", lastName: " bin   salim ", phone: " 0712 345 678 ", whatsapp: "  " })),
    ).toEqual({
      ok: true,
      data: { fullName: "REHEMA ALI BIN SALIM", phone: "0712 345 678", whatsapp: null, ...EMAIL },
    })
  })

  it("keeps a WhatsApp number as typed", () => {
    const parsed = parseAgentRegistration(posted({ ...NAMES, phone: "0712345678", whatsapp: "+255 754 000 111" }))
    expect(parsed).toEqual({ ok: true, data: { fullName: "REHEMA ALI JUMA", phone: "0712345678", whatsapp: "+255 754 000 111", ...EMAIL } })
  })

  it.each([
    ["no first name", { ...NAMES, firstName: "  ", phone: "0712345678" }, "full_name"],
    ["no middle name", { ...NAMES, middleName: "", phone: "0712345678" }, "full_name"],
    ["no last name", { ...NAMES, lastName: " ", phone: "0712345678" }, "full_name"],
    ["a name over 100 characters", { ...NAMES, lastName: "A".repeat(90), phone: "0712345678" }, "full_name"],
    ["no phone", { ...NAMES, phone: "  " }, "phone"],
    ["a phone too long to be one", { ...NAMES, phone: "0".repeat(41) }, "phone"],
    ["a WhatsApp too long to be one", { ...NAMES, phone: "0712345678", whatsapp: "0".repeat(41) }, "whatsapp"],
    ["no email", { ...NAMES, phone: "0712345678", email: " " }, "email"],
    ["an email without a domain", { ...NAMES, phone: "0712345678", email: "rehema@" }, "email"],
    ["Yes with no code", { ...NAMES, phone: "0712345678", has_code: "yes", code: "  " }, "code"],
    ["a code too long to be one", { ...NAMES, phone: "0712345678", has_code: "yes", code: "A".repeat(41) }, "code"],
  ])("refuses %s, naming the field", (_, fields, field) => {
    expect(parseAgentRegistration(posted(fields))).toEqual({ ok: false, error: field })
  })

  it("accepts a full name of exactly 100 characters, counting letters, not code units", () => {
    expect(parseAgentRegistration(posted({ firstName: "É".repeat(48), middleName: "É", lastName: "É".repeat(49), phone: "0712345678" })).ok).toBe(true)
  })

  it("lowercases the email, and reads Yes and the code", () => {
    expect(
      parseAgentRegistration(posted({ ...NAMES, phone: "0712345678", email: " Rehema@Example.TEST ", has_code: "yes", code: " rj-407 " })),
    ).toEqual({
      ok: true,
      data: { fullName: "REHEMA ALI JUMA", phone: "0712345678", whatsapp: null, email: "rehema@example.test", hasCode: true, code: "rj-407" },
    })
  })

  it("sends no code after No, whatever was typed", () => {
    const parsed = parseAgentRegistration(posted({ ...NAMES, phone: "0712345678", code: "RJ-407" }))
    expect(parsed).toMatchObject({ ok: true, data: { hasCode: false, code: null } })
  })

  it("treats a missing field as empty", () => {
    expect(parseAgentRegistration(new FormData())).toEqual({ ok: false, error: "full_name" })
  })

  it("checks a draft the same way on the page", () => {
    const draft = { ...NAMES, phone: "0712345678", whatsapp: "", email: "rehema@example.test", hasCode: false, code: "" }
    expect(agentRegistrationProblem({ ...draft, middleName: "" })).toBe("full_name")
    expect(agentRegistrationProblem({ ...draft, phone: "" })).toBe("phone")
    expect(agentRegistrationProblem({ ...draft, email: "" })).toBe("email")
    expect(agentRegistrationProblem({ ...draft, hasCode: true })).toBe("code")
    expect(agentRegistrationProblem({ ...draft, code: "stale" })).toBeNull()
    expect(agentRegistrationProblem(draft)).toBeNull()
  })
})

describe("the initials a new code starts with", () => {
  it("are the first letters of the first three names, as the database takes them", () => {
    expect(agentCodePrefix(agentFullName(NAMES))).toBe("RAJ")
    expect(agentCodePrefix(agentFullName({ firstName: "amina", middleName: "hassan", lastName: "bin salim" }))).toBe("AHB")
    expect(agentCodePrefix("JOHN DOE")).toBe("JD")
    expect(agentCodePrefix("ÉMILE ALI JUMA")).toBe("AJ")
    expect(agentCodePrefix("")).toBe("AR")
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
