import { describe, expect, it } from "vitest"

import { formatTzs, referralLookupNote, referralOutcome } from "@/app/staff/leads/[id]/referral-outcome"

describe("the Referral code panel's words", () => {
  it("writes amounts as whole shillings with thousands separators", () => {
    expect(formatTzs(30000)).toBe("TZS 30,000")
    expect(formatTzs(50000)).toBe("TZS 50,000")
  })

  it("confirms a saved or cleared code", () => {
    expect(referralOutcome({ ok: true, data: { code: "BJN-402" } }, "set")).toEqual({
      status: "saved",
      message: "Referral code set to BJN-402.",
    })
    expect(referralOutcome({ ok: true, data: { code: null } }, "clear")).toEqual({
      status: "saved",
      message: "Referral code cleared.",
    })
  })

  it("turns every refusal into a plain sentence, never a code", () => {
    const errors = ["forbidden", "not-found", "lead-closed", "unknown-code", "no-change", "unavailable", "signed-out"] as const
    for (const error of errors) {
      for (const action of ["set", "clear"] as const) {
        const outcome = referralOutcome({ ok: false, error }, action)
        expect(outcome.status).toBe("refused")
        expect(outcome.message).toMatch(/^[A-Z].*\.$/)
        expect(outcome.message).not.toContain(error)
      }
    }
    expect(referralOutcome({ ok: false, error: "no-change" }, "set").message).toBe("The lead already has this referral code.")
    expect(referralOutcome({ ok: false, error: "no-change" }, "clear").message).toBe(
      "This lead has no referral code to clear. Reload the page.",
    )
    expect(referralOutcome({ ok: false, error: "lead-closed" }, "set").message).toBe(
      "This lead is closed, so its referral code can't be changed.",
    )
  })

  it("names the agent as the code is typed, or says no agent has it", () => {
    expect(referralLookupNote({ status: "found", agent: { code: "BJN-402", fullName: "Baraka Juma Njoroge", state: "approved" } })).toBe(
      "Baraka Juma Njoroge · Approved",
    )
    expect(referralLookupNote({ status: "found", agent: { code: "ZNM-401", fullName: "Zawadi Neema", state: "pending" } })).toBe(
      "Zawadi Neema · Pending: no discount until the Manager approves the agent",
    )
    expect(referralLookupNote({ status: "none" })).toBe("No Marketing Agent has this code.")
    expect(referralLookupNote({ status: "unavailable" })).toBe("The code could not be checked just now. Try again in a moment.")
    expect(referralLookupNote({ status: "empty" })).toBe("Type the agent's code, such as ABC-123.")
    expect(referralLookupNote({ status: "checking" })).toBe("Checking the code…")
  })
})
