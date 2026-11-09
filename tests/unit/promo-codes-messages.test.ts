import { describe, expect, it } from "vitest"

import {
  codeCheckLine,
  comparisonNote,
  createdMessage,
  effectiveState,
  formatDay,
  promoAmountLine,
  promoRefusal,
  promoStateChip,
  savedMessage,
  stateEffect,
  stateMessage,
  stateVerb,
  typedPromoCode,
} from "@/app/staff/promo-codes/messages"

// The Promo codes page's words. What a code may be, and whether it is free,
// is the database's; these only word it.

describe("the Promo codes page's words", () => {
  it("reads a code as the database stores it", () => {
    expect(typedPromoCode(" insta 26 ")).toBe("INSTA26")
  })

  it("names each state, and reads an Active code past its last day as Expired", () => {
    expect(promoStateChip("active")).toEqual({ label: "Active", tone: "good" })
    expect(promoStateChip("paused")).toEqual({ label: "Paused", tone: "warn" })
    expect(promoStateChip("expired")).toEqual({ label: "Expired", tone: "warn" })
    expect(promoStateChip("ended")).toEqual({ label: "Ended", tone: "bad" })
    expect(effectiveState("active", "2026-11-08", "2026-11-09")).toBe("expired")
    // The last day still gives the discount.
    expect(effectiveState("active", "2026-11-09", "2026-11-09")).toBe("active")
    expect(effectiveState("active", null, "2026-11-09")).toBe("active")
    expect(effectiveState("paused", "2026-01-01", "2026-11-09")).toBe("paused")
    expect(effectiveState("ended", null, "2026-11-09")).toBe("ended")
  })

  it("writes the amount with the fee it leaves, and a day as a date", () => {
    expect(promoAmountLine(25000)).toEqual({ off: "TZS 25,000", fee: "· fee TZS 25,000" })
    expect(promoAmountLine(40000).fee).toBe("· fee TZS 10,000")
    expect(formatDay("2026-12-31")).toBe("31 Dec 2026")
  })

  it("says whether a typed code is free, and who holds it when it isn't", () => {
    expect(codeCheckLine({ status: "empty" })).toEqual({ text: "Letters and numbers, 4 to 12.", problem: false })
    expect(codeCheckLine({ status: "unreadable" }).text).toMatch(/No hyphen/)
    expect(codeCheckLine({ status: "available", code: "INSTA26" })).toEqual({ text: "INSTA26 is available.", problem: false })
    expect(codeCheckLine({ status: "taken", code: "AJM407", by: "agent" })).toEqual({
      text: "AJM407 is already used by a Marketing Agent.",
      problem: true,
    })
    expect(codeCheckLine({ status: "taken", code: "WAZAZI", by: "promo-code" }).text).toBe("WAZAZI is already used by another Promo code.")
    expect(codeCheckLine({ status: "unavailable" }).problem).toBe(false)
  })

  it("compares the amount with the most an agent's code gives", () => {
    expect(comparisonNote(40000, 15000)).toEqual({
      tone: "good",
      text: "More than any agent gives (TZS 15,000). A family with this code gains nothing by switching to an agent's code.",
    })
    expect(comparisonNote(15000, 15000)).toEqual({
      tone: "warn",
      text: "Same as the highest agent discount (TZS 15,000). An agent's code costs the family nothing extra.",
    })
    expect(comparisonNote(5000, 15000)).toEqual({
      tone: "warn",
      text: "Less than an agent can give (TZS 15,000). An agent could offer this family more.",
    })
  })

  it("says what Pause, Resume and End do before they are confirmed", () => {
    expect(stateVerb("paused")).toBe("Pause")
    expect(stateVerb("active")).toBe("Resume")
    expect(stateVerb("ended")).toBe("End")
    expect(stateEffect("paused")).toBe("Gives nothing off until resumed. Fees already Paid keep their amount.")
    expect(stateEffect("ended")).toBe(
      "Ended for good. The code stays in history and on its students, gives nothing off, and can never be reused.",
    )
    expect(stateEffect("active")).toBe("Gives its discount again on every fee not yet Paid.")
  })

  it("answers each save in plain words", () => {
    expect(createdMessage("INSTA26")).toBe("INSTA26 created. Parents can use it now.")
    expect(savedMessage("INSTA26", true, 6)).toBe("INSTA26 saved. 6 unpaid fees updated.")
    expect(savedMessage("INSTA26", false, 0)).toBe("INSTA26 saved.")
    expect(stateMessage("INSTA26", "paused")).toBe("INSTA26 paused.")
    expect(stateMessage("INSTA26", "active")).toBe("INSTA26 resumed.")
    expect(stateMessage("INSTA26", "ended")).toBe("INSTA26 ended.")
  })

  it("turns every refusal into a plain sentence, the field it belongs to when there is one", () => {
    const errors = [
      "forbidden",
      "not-found",
      "retired",
      "no-change",
      "invalid-amount",
      "invalid-reason",
      "unavailable",
      "uncertain",
      "code-taken",
      "ended",
      "invalid-code",
      "invalid-name",
      "invalid-note",
      "invalid-ends-on",
      "invalid-state",
      "signed-out",
    ] as const
    for (const error of errors) {
      const outcome = promoRefusal(error)
      expect(outcome.status).toBe("refused")
      expect(outcome.message).toMatch(/^[A-Z].*\.$/)
      if (error.includes("-")) expect(outcome.message).not.toContain(error)
    }
    expect(promoRefusal("code-taken")).toEqual({ status: "refused", message: "This code is already in use.", field: "code" })
    expect(promoRefusal("invalid-amount").field).toBe("amount")
    expect(promoRefusal("invalid-reason").field).toBe("reason")
    expect(promoRefusal("invalid-ends-on").field).toBe("endsOn")
    expect(promoRefusal("uncertain").message).toMatch(/reload the page/)
    expect(promoRefusal("not-found").message).toMatch(/Promo code/)
  })
})
