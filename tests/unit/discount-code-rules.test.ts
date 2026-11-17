import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { formatAgentCode, formatCode } from "@/components/guided-form/typing"
import { boxHyphenTwin, cleanDiscountCode, isPromoCode } from "@/lib/discount-code-rules"
import { normalizeDiscountCode } from "@/lib/referral-link"
import { withoutBoxHyphen } from "@/lib/services/referral"

// #462: Promo codes in any format, agent codes exactly ABC-123.

// What a box shows after `text` is typed into it one key at a time.
function typeInto(format: (raw: string, previous: string) => string, text: string, start = ""): string {
  let shown = start
  for (const key of text) shown = format(shown + key, shown)
  return shown
}

// The codes the Admission form looks up for what its box shows: as shown,
// then without the box's hyphen.
function formLookups(shown: string): string[] {
  const code = normalizeDiscountCode(shown)
  if (!code) return []
  const plain = withoutBoxHyphen(code)
  return plain ? [code, plain] : [code]
}

describe("what can be a Promo code", () => {
  it.each(["SAVE10", "KARIBU2026", "AS-135", "$AVE", "EID2026", "EID-2026", "X", "50%OFF!", "A.B-1", "ABC1234", "ABC-1", "ABCD-123", "AB-123", "ABC-123", "1".repeat(15)])(
    "takes %s",
    (code) => {
      expect(isPromoCode(code)).toBe(true)
    },
  )

  it.each([
    ["", "empty"],
    ["ABC--1", "three letters and two hyphens"],
    ["ABC--", "three letters and two hyphens"],
    ["1".repeat(16), "16 characters"],
    ["KODI€", "a symbol outside ! to ~"],
    ["SAVE 10", "a space"],
  ])("refuses %j (%s)", (code) => {
    expect(isPromoCode(code)).toBe(false)
  })

  it("is read the way the database stores it: no spaces, in capitals", () => {
    expect(cleanDiscountCode(" save 10 $ ")).toBe("SAVE10$")
  })
})

describe("the twin across the box's hyphen", () => {
  it("is the code with that hyphen added or taken away, only after three letters and before a digit", () => {
    expect(boxHyphenTwin("ABC-123")).toBe("ABC123")
    expect(boxHyphenTwin("ABC123")).toBe("ABC-123")
    expect(boxHyphenTwin("EID2026")).toBe("EID-2026")
    expect(boxHyphenTwin("AS-135")).toBeNull()
    expect(boxHyphenTwin("SAVE10")).toBeNull()
    expect(boxHyphenTwin("ABC-X1")).toBeNull()
  })
})

describe("every Promo code that can be created can be typed on the Admission form", () => {
  const promos = ["SAVE10", "KARIBU2026", "AS-135", "$AVE", "EID2026", "EID-2026", "ABC1X", "ABC-", "ABC-$", "A", "ABC" + "1".repeat(12), "ABC-" + "1".repeat(11), "ABCD-1"]

  it.each(promos)("%s, typed key by key in any case, is found", (promo) => {
    expect(isPromoCode(promo)).toBe(true)
    for (const typed of [promo, promo.toLowerCase()]) {
      expect(formLookups(typeInto(formatCode, typed))).toContain(promo)
      expect(formLookups(formatCode(typed))).toContain(promo)
    }
  })

  it("and a real agent code too, typed with or without its hyphen", () => {
    expect(typeInto(formatCode, "bjn402")).toBe("BJN-402")
    expect(typeInto(formatCode, "BJN-402")).toBe("BJN-402")
    expect(formLookups("BJN-402")[0]).toBe("BJN-402")
  })
})

describe("an agent's code box", () => {
  it("adds the hyphen right after the third letter and takes three digits", () => {
    expect(typeInto(formatAgentCode, "abc")).toBe("ABC-")
    expect(typeInto(formatAgentCode, "abc123")).toBe("ABC-123")
    expect(typeInto(formatAgentCode, "abc1234")).toBe("ABC-123")
  })

  it("ignores a hyphen typed again", () => {
    expect(typeInto(formatAgentCode, "abc-123")).toBe("ABC-123")
    expect(typeInto(formatAgentCode, "abc--1-23")).toBe("ABC-123")
  })

  it("drops what an agent's code can't hold", () => {
    expect(typeInto(formatAgentCode, "a1b c$d")).toBe("ABC-")
    expect(formatAgentCode(" bjn 402 ")).toBe("BJN-402")
    expect(formatAgentCode("bjn-402x9")).toBe("BJN-402")
  })

  it("lets the hyphen be deleted to correct the letters", () => {
    expect(formatAgentCode("ABC", "ABC-")).toBe("ABC")
    expect(formatAgentCode("AB", "ABC")).toBe("AB")
    expect(formatAgentCode("ABC-", "ABC-1")).toBe("ABC-")
    expect(typeInto(formatAgentCode, "1", "ABC")).toBe("ABC-1")
  })
})
