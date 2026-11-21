import { afterEach, describe, expect, it, vi } from "vitest"

import { clearDraft, DRAFT_KEY, EMPTY_PARENT, emptyChild, parseDraft, readDraft, writeDraft, type Draft } from "@/app/apply/draft"

const YEARS = [2026, 2027]

const DRAFT: Draft = {
  parent: {
    firstName: "AMINA",
    middleName: "HASSANI",
    lastName: "FIXTURE",
    custodian: "other",
    relationship: "Mother",
    relationshipDescription: "",
    phone: "0700 000 900",
    whatsapp: "",
  },
  children: [
    { card: 4, firstName: "ZAWADI", fatherFirst: "JUMA", fatherMiddle: "ALI", fatherLast: "FIXTURE", lastNameFrom: "father_middle", gender: "Girl", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" },
    { card: 7, firstName: "JUMA", fatherFirst: "JUMA", fatherMiddle: "ALI", fatherLast: "FIXTURE", lastNameFrom: "father_last", gender: "Boy", className: "FORM 1", enrollmentYear: 2026, dayOrBoarding: "Boarding" },
  ],
  discountCode: "AMINA-1",
  linkCode: "BJN-402",
  done: ["name-1", "gender-1", "class-1", "board-1", "name-2", "pname"],
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
    expect(Object.keys(stored).sort()).toEqual(["children", "discountCode", "done", "linkCode", "parent", "version"])
    expect(JSON.stringify(stored)).not.toMatch(/submission|turnstile|token|card/i)
  })

  it("is removed when cleared, and an untouched form keeps none", () => {
    writeDraft(DRAFT)
    clearDraft()
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull()

    writeDraft(DRAFT)
    writeDraft({ parent: EMPTY_PARENT, children: [emptyChild(1)], discountCode: "FROM-LINK", linkCode: "FROM-LINK", done: [] })
    expect(window.sessionStorage.getItem(DRAFT_KEY)).toBeNull()
  })

  it("drops a year, class or choice the form no longer offers, field by field", () => {
    writeDraft({
      ...DRAFT,
      parent: { ...DRAFT.parent, relationship: "Uncle" },
      children: [{ ...DRAFT.children[0], card: 1, gender: "Other", className: "STD 9", enrollmentYear: 2025, dayOrBoarding: "Weekly" }],
    })
    const draft = readDraft(YEARS)!
    expect(draft.parent.relationship).toBe("")
    expect(draft.parent.firstName).toBe("AMINA")
    expect(draft.children).toEqual([{ ...DRAFT.children[0], card: 1, gender: "", className: "", enrollmentYear: null, dayOrBoarding: "" }])
  })

  it("brings back a draft from before boy or girl with the question unanswered and the other answers kept", () => {
    const { gender: _gender, ...before } = DRAFT.children[0]
    void _gender
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...DRAFT, version: 3, children: [before], done: ["name-1", "class-1", "board-1"] }))
    const draft = readDraft(YEARS)!
    expect(draft.children).toEqual([{ ...DRAFT.children[0], card: 1, gender: "" }])
    expect(draft.done).toEqual(["name-1", "class-1", "board-1"])
  })

  it("ignores anything that isn't a draft this form wrote", () => {
    expect(parseDraft(null, YEARS)).toBeNull()
    expect(parseDraft("{not json", YEARS)).toBeNull()
    expect(parseDraft(JSON.stringify({ version: 99, parent: DRAFT.parent }), YEARS)).toBeNull()
    // The three-step form's drafts (version 1) start the new form afresh.
    expect(parseDraft(JSON.stringify({ ...DRAFT, version: 1 }), YEARS)).toBeNull()
    const odd = parseDraft(
      JSON.stringify({ version: 3, parent: { firstName: 7, fatherCustodian: "yes" }, children: "two", discountCode: ["x"], done: "all" }),
      YEARS,
    )
    expect(odd).toEqual({ parent: EMPTY_PARENT, children: [emptyChild(1)], discountCode: "", linkCode: "", done: [] })
    const many = parseDraft(JSON.stringify({ version: 3, parent: {}, children: Array(12).fill({}) }), YEARS)
    expect(many?.children).toHaveLength(8)
  })

  it("keeps who the custodian is", () => {
    writeDraft({ ...DRAFT, parent: { ...DRAFT.parent, custodian: "father", relationship: "Father" } })
    expect(readDraft(YEARS)?.parent).toMatchObject({ custodian: "father", relationship: "Father" })
    writeDraft({ ...DRAFT, parent: { ...DRAFT.parent, custodian: "" } })
    expect(readDraft(YEARS)?.parent.custodian).toBe("")
  })

  it("brings back a draft from the father switch (version 3): on is The father, off with a name typed is Someone else (#513)", () => {
    const v3 = (parent: Record<string, unknown>) =>
      JSON.stringify({ version: 3, parent: { ...parent, relationship: "Mother", phone: "0700 000 900" }, children: [{ firstName: "ZAWADI", fatherFirst: "JUMA", fatherMiddle: "ALI", fatherLast: "FIXTURE" }] })
    expect(parseDraft(v3({ fatherCustodian: true }), YEARS)?.parent.custodian).toBe("father")
    expect(parseDraft(v3({ fatherCustodian: false, firstName: "AMINA" }), YEARS)?.parent).toMatchObject({ custodian: "other", firstName: "AMINA" })
    expect(parseDraft(v3({ fatherCustodian: false }), YEARS)?.parent.custodian).toBe("")
    // The last-name choice came later: his last name.
    expect(parseDraft(v3({}), YEARS)?.children[0].lastNameFrom).toBe("father_last")
  })

  it("drops a custodian or a last-name choice it doesn't know", () => {
    const odd = parseDraft(
      JSON.stringify({ version: 4, parent: { custodian: "mother" }, children: [{ firstName: "ZAWADI", lastNameFrom: "mother" }] }),
      YEARS,
    )
    expect(odd?.parent.custodian).toBe("")
    expect(odd?.children[0].lastNameFrom).toBe("father_last")
  })

  it("brings back a draft from before the name boxes with its names empty and its other answers kept", () => {
    const old = {
      version: 2,
      parent: { fullName: "Amina Fixture", relationship: "Mother", relationshipDescription: "", phone: "0700 000 900", whatsapp: "" },
      children: [{ fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" }],
      discountCode: "AMINA-1",
      linkCode: "",
      done: ["name-1", "class-1"],
    }
    expect(parseDraft(JSON.stringify(old), YEARS)).toEqual({
      parent: { ...EMPTY_PARENT, relationship: "Mother", phone: "0700 000 900" },
      children: [{ ...emptyChild(1), className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" }],
      discountCode: "AMINA-1",
      linkCode: "",
      done: ["name-1", "class-1"],
    })
  })

  it("keeps only the answered questions it knows by name", () => {
    writeDraft({ ...DRAFT, done: ["name-1", "gender-1", "class-9", "gender-9", "send", "<script>", "code", "fee"] })
    expect(readDraft(YEARS)?.done).toEqual(["name-1", "gender-1", "code", "fee"])
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
