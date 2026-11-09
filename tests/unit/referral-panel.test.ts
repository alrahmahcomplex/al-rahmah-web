import { describe, expect, it } from "vitest"

import {
  discountNote,
  formatTzs,
  givesDiscount,
  promoCodeNote,
  referralFeeLine,
  referralLookupNote,
  referralOutcome,
  usableCode,
} from "@/app/staff/applicants/[id]/referral-outcome"
import type { FoundDiscountCode } from "@/lib/services/referral"

function agentCode(over: Partial<FoundDiscountCode>): FoundDiscountCode {
  return {
    kind: "agent",
    code: "BJN-402",
    holderName: "Baraka Juma Njoroge",
    state: "approved",
    amountOff: 10000,
    agentId: "a9e00000-0000-4000-8000-000000000402",
    promoCodeId: null,
    ...over,
  }
}

function promoCode(over: Partial<FoundDiscountCode>): FoundDiscountCode {
  return {
    kind: "promo",
    code: "INSTA26",
    holderName: "Instagram ad",
    state: "active",
    amountOff: 25000,
    agentId: null,
    promoCodeId: "9a000000-0000-4000-8000-000000000026",
    ...over,
  }
}

describe("the Referral code panel's words", () => {
  it("writes amounts as whole shillings with thousands separators", () => {
    expect(formatTzs(40000)).toBe("TZS 40,000")
    expect(formatTzs(50000)).toBe("TZS 50,000")
  })

  it("names the amount the code itself takes off", () => {
    expect(discountNote(true, 10000)).toBe("includes TZS 10,000 discount")
    expect(discountNote(true, 25000)).toBe("includes TZS 25,000 discount")
    expect(discountNote(false, 10000)).toBeNull()
    expect(discountNote(true, 0)).toBeNull()
  })

  it("shows the expected fee while the current interview fee is unpaid or there is no interview", () => {
    const referral = { amount: 40000, discountApplied: true, state: "approved" as const, amountOff: 10000 }
    const expected = { label: "Expected interview fee", amount: "TZS 40,000", note: "includes TZS 10,000 discount", pending: false }
    expect(referralFeeLine(referral, null)).toEqual(expected)
    expect(referralFeeLine(referral, { feeStatus: "Not Paid", amount: 40000, discountApplied: true })).toEqual(expected)
    expect(referralFeeLine({ amount: 50000, discountApplied: false, state: "pending" }, null)).toEqual({
      label: "Expected interview fee",
      amount: "TZS 50,000",
      note: null,
      pending: true,
    })
  })

  it("shows the amount locked when the current interview fee was Paid, not the live expected fee", () => {
    const referral = { amount: 40000, discountApplied: true, state: "pending" as const }
    expect(referralFeeLine(referral, { feeStatus: "Paid", amount: 30000, discountApplied: false })).toEqual({
      label: "Interview fee paid",
      amount: "TZS 30,000",
      note: null,
      pending: false,
    })
    expect(referralFeeLine(referral, { feeStatus: "Paid", amount: 20000, discountApplied: true })).toEqual({
      label: "Interview fee paid",
      amount: "TZS 20,000",
      note: "includes the Referral code discount",
      pending: false,
    })
  })

  it("says the code is switched off, and since when, on a fee not yet Paid", () => {
    const referral = { amount: 50000, discountApplied: false, state: "switched_off" as const, switchedOffAt: "2026-11-04T06:30:00Z" }
    expect(referralFeeLine(referral, null)).toEqual({
      label: "Expected interview fee",
      amount: "TZS 50,000",
      note: "No discount: code switched off on 4 Nov 2026",
      pending: false,
    })
    // A Paid fee keeps its locked amount, and says nothing of the switch-off.
    expect(referralFeeLine(referral, { feeStatus: "Paid", amount: 40000, discountApplied: true })).toEqual({
      label: "Interview fee paid",
      amount: "TZS 40,000",
      note: "includes the Referral code discount",
      pending: false,
    })
  })

  it("says a Promo code's own amount, and nothing of an agent, on a fee not yet Paid", () => {
    const promo = { amount: 25000, discountApplied: true, state: "approved" as const, kind: "promo" as const, discountState: "active" as const, amountOff: 25000 }
    expect(referralFeeLine(promo, null)).toEqual({
      label: "Expected interview fee",
      amount: "TZS 25,000",
      note: "includes TZS 25,000 discount",
      pending: false,
    })
    const paused = { ...promo, amount: 50000, discountApplied: false, state: "switched_off" as const, discountState: "paused" as const, amountOff: 0 }
    expect(referralFeeLine(paused, null).note).toBe("No discount: Promo code paused")
    expect(referralFeeLine({ ...paused, discountState: "expired" as const }, null).note).toBe("No discount: Promo code expired")
    expect(referralFeeLine({ ...paused, discountState: "ended" as const }, null).note).toBe("No discount: Promo code ended")
  })

  it("tells staff a typed code is switched off", () => {
    expect(referralLookupNote({ status: "found", code: agentCode({ holderName: "Baraka", state: "switched_off", amountOff: 0 }) })).toBe(
      "Baraka · This code is switched off. No discount.",
    )
  })

  it("names a typed Promo code with its state and amount, and no agent", () => {
    expect(referralLookupNote({ status: "found", code: promoCode({}) })).toBe(
      "Instagram ad · Promo code, Active · TZS 25,000 off. No Marketing Agent. No commission.",
    )
    expect(referralLookupNote({ status: "found", code: promoCode({ state: "ended", amountOff: 0 }) })).toBe(
      "Instagram ad · Promo code, Ended · no discount. No Marketing Agent. No commission.",
    )
    expect(promoCodeNote({ holderName: "Wazazi", state: "expired", amountOff: 0 })).toBe(
      "Wazazi · Promo code, Expired · no discount. No Marketing Agent. No commission.",
    )
  })

  it("takes any code but a retired agent record's", () => {
    expect(usableCode({ status: "found", code: promoCode({ state: "paused", amountOff: 0 }) })?.code).toBe("INSTA26")
    expect(usableCode({ status: "found", code: agentCode({ state: "pending", amountOff: 0 }) })?.code).toBe("BJN-402")
    expect(usableCode({ status: "found", code: agentCode({ state: "retired", amountOff: 0 }) })).toBeNull()
    expect(usableCode({ status: "none" })).toBeNull()
    expect(referralLookupNote({ status: "found", code: agentCode({ state: "retired", amountOff: 0 }) })).toBe(
      "This code belongs to a retired Marketing Agent record, so it can't be used.",
    )
    expect(givesDiscount({ status: "found", code: promoCode({}) })).toBe(true)
    expect(givesDiscount({ status: "found", code: promoCode({ state: "paused", amountOff: 0 }) })).toBe(false)
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
    expect(referralLookupNote({ status: "found", code: agentCode({}) })).toBe(
      "Baraka Juma Njoroge · Approved",
    )
    expect(referralLookupNote({ status: "found", code: agentCode({ code: "ZNM-401", holderName: "Zawadi Neema", state: "pending", amountOff: 0 }) })).toBe(
      "Zawadi Neema · Pending: no discount until the Manager approves the agent",
    )
    expect(referralLookupNote({ status: "none" })).toBe("No Marketing Agent or Promo code has this code.")
    expect(referralLookupNote({ status: "unavailable" })).toBe("The code could not be checked just now. Try again in a moment.")
    expect(referralLookupNote({ status: "empty" })).toBe("Type the agent's code, such as ABC-123, or a Promo code.")
    expect(referralLookupNote({ status: "checking" })).toBe("Checking the code…")
  })
})
