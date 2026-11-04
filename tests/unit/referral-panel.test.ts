import { describe, expect, it } from "vitest"

import { discountNote, formatTzs, referralFeeLine, referralLookupNote, referralOutcome } from "@/app/staff/leads/[id]/referral-outcome"

describe("the Referral code panel's words", () => {
  it("writes amounts as whole shillings with thousands separators", () => {
    expect(formatTzs(40000)).toBe("TZS 40,000")
    expect(formatTzs(50000)).toBe("TZS 50,000")
  })

  it("names the discount the database gives, or none when it couldn't be read", () => {
    expect(discountNote(true, 10000)).toBe("includes TZS 10,000 discount")
    expect(discountNote(true, null)).toBe("includes the agent discount")
    expect(discountNote(false, 10000)).toBeNull()
  })

  it("shows the expected fee while the current interview fee is unpaid or there is no interview", () => {
    const referral = { amount: 40000, discountApplied: true, state: "approved" as const }
    const expected = { label: "Expected interview fee", amount: "TZS 40,000", note: "includes TZS 10,000 discount", pending: false }
    expect(referralFeeLine(referral, 10000, null)).toEqual(expected)
    expect(referralFeeLine(referral, 10000, { feeStatus: "Not Paid", amount: 40000, discountApplied: true })).toEqual(expected)
    expect(referralFeeLine({ amount: 50000, discountApplied: false, state: "pending" }, 10000, null)).toEqual({
      label: "Expected interview fee",
      amount: "TZS 50,000",
      note: null,
      pending: true,
    })
  })

  it("shows the amount locked when the current interview fee was Paid, not the live expected fee", () => {
    const referral = { amount: 40000, discountApplied: true, state: "pending" as const }
    expect(referralFeeLine(referral, 10000, { feeStatus: "Paid", amount: 30000, discountApplied: false })).toEqual({
      label: "Interview fee paid",
      amount: "TZS 30,000",
      note: null,
      pending: false,
    })
    expect(referralFeeLine(referral, 10000, { feeStatus: "Paid", amount: 20000, discountApplied: true })).toEqual({
      label: "Interview fee paid",
      amount: "TZS 20,000",
      note: "includes the Referral code discount",
      pending: false,
    })
  })

  it("says the code is switched off, and since when, on a fee not yet Paid", () => {
    const referral = { amount: 50000, discountApplied: false, state: "switched_off" as const, switchedOffAt: "2026-11-04T06:30:00Z" }
    expect(referralFeeLine(referral, 10000, null)).toEqual({
      label: "Expected interview fee",
      amount: "TZS 50,000",
      note: "No discount: code switched off on 4 Nov 2026",
      pending: false,
    })
    // A Paid fee keeps its locked amount, and says nothing of the switch-off.
    expect(referralFeeLine(referral, 10000, { feeStatus: "Paid", amount: 40000, discountApplied: true })).toEqual({
      label: "Interview fee paid",
      amount: "TZS 40,000",
      note: "includes the Referral code discount",
      pending: false,
    })
  })

  it("tells staff a typed code is switched off", () => {
    expect(referralLookupNote({ status: "found", agent: { code: "BJN-402", fullName: "Baraka", state: "switched_off" } })).toBe(
      "Baraka · This code is switched off. No discount.",
    )
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
    const errors = ["forbidden", "not-found", "lead-closed", "unknown-code", "retired-code", "no-change", "unavailable", "signed-out"] as const
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
