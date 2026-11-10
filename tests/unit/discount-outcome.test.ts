import { describe, expect, it } from "vitest"

import {
  agentDiscountOutcome,
  discountRefusal,
  familyNotice,
  feeBecomes,
  impactRefusal,
  impactSummary,
  parseAmount,
  standardDiscountOutcome,
  standardHelp,
  standardLine,
} from "@/app/staff/agents/discount-outcome"
import { createRefusal, PROMO_CODE_TAKEN } from "@/app/staff/agents/outcome"

// The discount sheets' words on Marketing Agents. The amounts and the
// families they move are the database's; these only word them.

describe("the discount sheets' words", () => {
  it("reads a typed amount as whole shillings from 0 to 50,000, or nothing", () => {
    expect(parseAmount("15000")).toBe(15000)
    expect(parseAmount(" 0 ")).toBe(0)
    expect(parseAmount("50000")).toBe(50000)
    expect(parseAmount("50001")).toBeNull()
    expect(parseAmount("-500")).toBeNull()
    expect(parseAmount("12.5")).toBeNull()
    expect(parseAmount("")).toBeNull()
    expect(parseAmount("1e4")).toBeNull()
  })

  it("says the fee an amount leaves, and who the standard covers", () => {
    expect(feeBecomes(15000)).toBe("Fee becomes TZS 35,000")
    expect(standardHelp(12000, 3)).toBe(
      "Fee becomes TZS 38,000 for 3 agents on the standard amount. The agent sign-up page quotes this figure.",
    )
    expect(standardHelp(10000, 1)).toContain("for 1 agent on")
    expect(standardLine(2)).toBe("· 2 approved agents on it")
    expect(standardLine(1)).toBe("· 1 approved agent on it")
  })

  it("counts the unpaid fees a change moves and gives the line to read to each family", () => {
    expect(impactSummary(1)).toBe("1 unpaid interview fee will change")
    expect(impactSummary(3)).toBe("3 unpaid interview fees will change")
    expect(familyNotice([{ feeAfter: 35000 }, { feeAfter: 35000 }])).toBe(
      "Ada ya usaili imebadilika kutokana na code yako. Kiasi kipya ni TZS 35,000 kwa kila mtoto.",
    )
  })

  it("answers a save with the code, the amount and the fees it moved", () => {
    expect(agentDiscountOutcome({ ok: true, data: { feeChangeCount: 3 } }, "AJM-407", 15000)).toEqual({
      status: "saved",
      message: "AJM-407 now gives TZS 15,000 off. 3 unpaid fees updated.",
    })
    expect(agentDiscountOutcome({ ok: true, data: { feeChangeCount: 1 } }, "AJM-407", 10000).message).toBe(
      "AJM-407 now gives TZS 10,000 off. 1 unpaid fee updated.",
    )
    expect(standardDiscountOutcome({ ok: true, data: { feeChangeCount: 4 } }, 12000)).toEqual({
      status: "saved",
      message: "Standard discount is now TZS 12,000 off.",
    })
  })

  it("turns every refusal into a plain sentence, never a code", () => {
    const writes = ["forbidden", "not-found", "retired", "no-change", "invalid-amount", "invalid-reason", "unavailable", "uncertain", "signed-out"] as const
    for (const error of writes) {
      const message = discountRefusal(error)
      expect(message).toMatch(/^[A-Z].*\.$/)
      if (error.includes("-")) expect(message).not.toContain(error)
      expect(agentDiscountOutcome({ ok: false, error }, "AJM-407", 0)).toEqual({ status: "refused", message })
    }
    for (const error of ["forbidden", "not-found", "retired", "invalid-amount", "unavailable", "signed-out"] as const) {
      expect(impactRefusal(error)).toMatch(/^[A-Z].*\.$/)
    }
    // A change that may have been saved says to check before trying again.
    expect(discountRefusal("uncertain")).toMatch(/reload the page/)
    expect(discountRefusal("unavailable")).toMatch(/Nothing was changed/)
  })

  it("says a Promo code holds a code typed for a new agent", () => {
    expect(createRefusal({ kind: "promo-code-taken" })).toEqual({ field: "code", message: PROMO_CODE_TAKEN })
    expect(PROMO_CODE_TAKEN).toBe("A Promo code already uses this code.")
  })
})
