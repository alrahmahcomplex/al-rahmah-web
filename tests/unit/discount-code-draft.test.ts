import { beforeEach, describe, expect, it } from "vitest"

import { clearDraft, DRAFT_KEY, isEmptyDraft, parseDraft, readDraft, writeDraft, type DiscountCodeDraft } from "@/app/discount-code/draft"

// The Discount code form's draft (#503 slice 4d): the tab's sessionStorage only,
// read back field by field, and gone once cleared.

const DRAFT: DiscountCodeDraft = {
  firstName: "REHEMA",
  middleName: "ALI",
  lastName: "JUMA",
  phone: "0712 345 678",
  whatsapp: "",
  whatsappOn: false,
  email: "rehema@example.test",
  codeAnswer: "no",
  code: "",
  answered: ["name", "phone", "email", "has"],
}

beforeEach(() => {
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe("the Discount code draft", () => {
  it("round-trips through sessionStorage and never touches localStorage", () => {
    writeDraft(DRAFT)
    expect(readDraft()).toEqual(DRAFT)
    expect(window.localStorage.length).toBe(0)
    clearDraft()
    expect(readDraft()).toBeNull()
  })

  it("keeps no draft for an untouched form", () => {
    const empty = { ...DRAFT, firstName: "", middleName: "", lastName: "", phone: "", email: "", codeAnswer: null, answered: [] }
    expect(isEmptyDraft(empty)).toBe(true)
    writeDraft(empty)
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("drops what the form never wrote, field by field", () => {
    const raw = JSON.stringify({
      version: 1,
      firstName: "A".repeat(500),
      phone: 712,
      whatsappOn: "yes",
      codeAnswer: "maybe",
      code: "ABC-123-EXTRA-LONG-CODE",
      answered: ["name", "bogus", "name", 3],
      token: "cf-secret",
    })
    const parsed = parseDraft(raw)!
    expect(parsed.firstName).toHaveLength(200)
    expect(parsed.phone).toBe("")
    expect(parsed.whatsappOn).toBe(false)
    expect(parsed.codeAnswer).toBeNull()
    expect(parsed.code).toHaveLength(20)
    expect(parsed.answered).toEqual(["name"])
    expect(parsed).not.toHaveProperty("token")
  })

  it("ignores another version or anything that isn't JSON", () => {
    expect(parseDraft(JSON.stringify({ ...DRAFT, version: 2 }))).toBeNull()
    expect(parseDraft("{not json")).toBeNull()
    expect(parseDraft(null)).toBeNull()
  })
})
