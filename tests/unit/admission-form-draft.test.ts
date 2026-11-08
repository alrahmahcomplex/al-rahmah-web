import { afterEach, describe, expect, it, vi } from "vitest"

import { clearDraft, DRAFT_KEY, EMPTY_PARENT, emptyChild, parseDraft, readDraft, writeDraft, type Draft } from "@/app/apply/draft"

const YEARS = [2026, 2027]

const DRAFT: Draft = {
  parent: { fullName: "Amina Fixture", relationship: "Mother", relationshipDescription: "", phone: "0700 000 900", whatsapp: "" },
  children: [
    { card: 4, fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" },
    { card: 7, fullName: "Juma Fixture", className: "FORM 1", enrollmentYear: 2026, dayOrBoarding: "Boarding" },
  ],
  discountCode: "AMINA-1",
  linkCode: "BJN-402",
}

afterEach(() => {
  vi.restoreAllMocks()
  window.sessionStorage.clear()
  window.localStorage.clear()
})

describe("the Admission form's draft", () => {
  it("comes back from sessionStorage as written, with cards numbered afresh", () => {
    writeDraft(DRAFT)
    expect(readDraft(YEARS)).toEqual({
      ...DRAFT,
      children: DRAFT.children.map((child, index) => ({ ...child, card: index + 1 })),
    })
  })

  it("lives in sessionStorage only, and holds no submission key or security token", () => {
    writeDraft(DRAFT)
    expect(window.localStorage.length).toBe(0)
    expect(document.cookie).toBe("")
    const stored = JSON.parse(window.sessionStorage.getItem(DRAFT_KEY)!)
    expect(Object.keys(stored).sort()).toEqual(["children", "discountCode", "linkCode", "parent", "version"])
    expect(JSON.stringify(stored)).not.toMatch(/submission|turnstile|token|card/i)
  })

  it("is removed when cleared, and an untouched form keeps none", () => {
    writeDraft(DRAFT)
    clearDraft()
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull()

    writeDraft(DRAFT)
    writeDraft({ parent: EMPTY_PARENT, children: [emptyChild(1)], discountCode: "FROM-LINK", linkCode: "FROM-LINK" })
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("drops a year, class or choice the form no longer offers, field by field", () => {
    writeDraft({
      ...DRAFT,
      parent: { ...DRAFT.parent, relationship: "Uncle" },
      children: [{ card: 1, fullName: "Zawadi Fixture", className: "STD 9", enrollmentYear: 2025, dayOrBoarding: "Weekly" }],
    })
    const draft = readDraft(YEARS)!
    expect(draft.parent.relationship).toBe("")
    expect(draft.parent.fullName).toBe("Amina Fixture")
    expect(draft.children).toEqual([{ card: 1, fullName: "Zawadi Fixture", className: "", enrollmentYear: null, dayOrBoarding: "" }])
  })

  it("ignores anything that isn't a draft this form wrote", () => {
    expect(parseDraft(null, YEARS)).toBeNull()
    expect(parseDraft("{not json", YEARS)).toBeNull()
    expect(parseDraft(JSON.stringify({ version: 99, parent: DRAFT.parent }), YEARS)).toBeNull()
    const odd = parseDraft(JSON.stringify({ version: 1, parent: { fullName: 7 }, children: "two", discountCode: ["x"] }), YEARS)
    expect(odd).toEqual({ parent: EMPTY_PARENT, children: [emptyChild(1)], discountCode: "", linkCode: "" })
    const many = parseDraft(JSON.stringify({ version: 1, parent: {}, children: Array(12).fill({}) }), YEARS)
    expect(many?.children).toHaveLength(8)
  })

  it("works without a draft when storage is blocked", () => {
    vi.spyOn(window, "sessionStorage", "get").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError")
    })
    expect(() => writeDraft(DRAFT)).not.toThrow()
    expect(readDraft(YEARS)).toBeNull()
    expect(() => clearDraft()).not.toThrow()
  })

  it("carries on when storage is full", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError")
    })
    expect(() => writeDraft(DRAFT)).not.toThrow()
  })
})
