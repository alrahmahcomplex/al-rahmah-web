import { describe, expect, it } from "vitest"

import { emailTakenFrom, emailTakenMessage } from "@/lib/email-in-use"

describe("an email already in use", () => {
  it("names only an agent holder, as the database sent them", () => {
    expect(emailTakenFrom(JSON.stringify({ email: "a@example.test", holder: "agent", name: "Neema", code: "NE-101" }), null)).toEqual({
      kind: "email-taken",
      email: "a@example.test",
      agent: { name: "Neema", code: "NE-101" },
    })
  })

  it("ignores a name sent with any holder but an agent", () => {
    expect(emailTakenFrom(JSON.stringify({ email: "a@example.test", holder: "staff", name: "Test Manager" }), null)).toEqual({
      kind: "email-taken",
      email: "a@example.test",
      agent: null,
    })
  })

  it("falls back to the email as typed when the detail carries none", () => {
    expect(emailTakenFrom(null, " Someone@Example.test ")).toEqual({ kind: "email-taken", email: "someone@example.test", agent: null })
    expect(emailTakenFrom("not json", "b@example.test")).toEqual({ kind: "email-taken", email: "b@example.test", agent: null })
  })

  it("says one sentence for a holder the caller can't see", () => {
    expect(emailTakenMessage({ kind: "email-taken", email: "a@example.test", agent: null })).toBe(
      "a@example.test is already in use at Al-Rahmah. Use another email.",
    )
    expect(emailTakenMessage({ kind: "email-taken", email: "a@example.test", agent: { name: null, code: null } })).toBe(
      "This email belongs to another agent.",
    )
  })
})
