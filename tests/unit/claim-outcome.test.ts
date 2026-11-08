import { describe, expect, it } from "vitest"

import { claimRefusal, confirmedOutcome } from "@/app/staff/agents/claim-outcome"

// The queue's words (#193): a confirmed claim stands whatever the invite does.

describe("after Confirm", () => {
  const agent = { fullName: "Zawadi Juma" }

  it("names the address the invite went to", () => {
    expect(confirmedOutcome(agent, "zawadi@example.test", { ok: true, data: { email: "zawadi@example.test", resend: false } })).toEqual({
      status: "done",
      message: "Email confirmed for Zawadi Juma. Invite sent to zawadi@example.test.",
    })
  })

  it("asks for approval first for a Pending agent", () => {
    expect(confirmedOutcome(agent, "z@example.test", { ok: false, error: { kind: "not-approved" } }).message).toBe(
      "Email confirmed for Zawadi Juma. Approve them to send the invite.",
    )
  })

  it("keeps the email saved when the invite fails, and says why", () => {
    expect(confirmedOutcome(agent, "z@example.test", { ok: false, error: { kind: "rate-limited" } })).toEqual({
      status: "done",
      message: "Email confirmed for Zawadi Juma. Invite not sent: the hourly email limit is reached. Resend later.",
    })
  })
})

describe("a refused decision", () => {
  it("names an agent holding the email, and says only that anyone else's is in use", () => {
    expect(claimRefusal({ kind: "email-taken", email: "neema@example.test", agent: { name: "Neema", code: "NE-101" } })).toBe(
      "This email belongs to agent Neema (NE-101).",
    )
    expect(claimRefusal({ kind: "email-taken", email: "manager@example.test", agent: null })).toBe(
      "manager@example.test is already in use at Al-Rahmah. Use another email.",
    )
  })

  it("never offers to replace an email the record already has", () => {
    expect(claimRefusal({ kind: "has-email" })).toMatch(/a claim never replaces/)
  })
})
