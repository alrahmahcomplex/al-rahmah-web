import { describe, expect, it } from "vitest"

import { EMPTY_PARENT, type ChildDraft } from "@/app/apply/draft"
import { defaultYear, firstOpenable, furthest, keyToParam, order, paramToKey, restoreDone, stepProblems, yearOf, type StepKey } from "@/app/apply/flow"

const YEARS = [2026, 2027] as const
const neema: ChildDraft = { card: 3, fullName: "Neema Mfano", className: "FORM 1", enrollmentYear: 2027, dayOrBoarding: "Day" }
const juma: ChildDraft = { card: 5, fullName: "Juma Mfano", className: "", enrollmentYear: null, dayOrBoarding: "" }
const parent = { fullName: "Asha Mfano", relationship: "Mother", relationshipDescription: "", phone: "0712 345 678", whatsapp: "" }

describe("the Admission form's order of questions", () => {
  it("asks each student's name, class and Day or Boarding, then another student, the custodian, the code, the fee and the send", () => {
    expect(order([neema, juma])).toEqual([
      "name:3", "class:3", "board:3", "name:5", "class:5", "board:5", "more", "pname", "rel", "phone", "code", "fee", "send",
    ])
  })

  it("drops 'another student?' once the form has eight", () => {
    const eight = Array.from({ length: 8 }, (_, i) => ({ ...juma, card: i + 1 }))
    expect(order(eight)).not.toContain("more")
  })

  it("opens the first question not answered", () => {
    expect(furthest([neema], new Set<StepKey>(["name:3", "class:3"]))).toBe("board:3")
    expect(furthest([neema], new Set<StepKey>(order([neema]).filter((key) => key !== "send")))).toBe("send")
  })

  it("names a student's question by their place on the form, in the URL and the draft", () => {
    expect(keyToParam("class:5", [neema, juma])).toBe("class-2")
    expect(paramToKey("class-2", [neema, juma])).toBe("class:5")
    expect(paramToKey("class-3", [neema, juma])).toBeNull()
    expect(paramToKey("code", [neema])).toBe("code")
    expect(paramToKey("javascript:1", [neema])).toBeNull()
  })
})

describe("answers after a reload", () => {
  it("counts the draft's answered questions up to the first that no longer holds", () => {
    const entries = { parent, children: [neema, juma], discountCode: "" }
    const done = restoreDone(["name-1", "class-1", "board-1", "name-2", "class-2", "pname"], entries, YEARS)
    expect([...done]).toEqual(["name:3", "class:3", "board:3", "name:5"])
    expect(firstOpenable(entries, done, YEARS)).toBe("class:5")
  })

  it("reopens the class question when the draft's year is no longer offered", () => {
    const entries = { parent, children: [{ ...neema, enrollmentYear: null }], discountCode: "" }
    const done = restoreDone(["name-1", "class-1", "board-1", "more", "pname"], entries, YEARS)
    expect([...done]).toEqual(["name:3"])
    expect(firstOpenable(entries, done, YEARS)).toBe("class:3")
  })

  it("reopens a question whose answer was emptied", () => {
    const entries = { parent: EMPTY_PARENT, children: [{ ...neema, fullName: " " }], discountCode: "" }
    const done = new Set<StepKey>(["name:3", "class:3"])
    expect(firstOpenable(entries, done, YEARS)).toBe("name:3")
    expect(stepProblems("name:3", entries, YEARS)).toEqual([{ field: "student_name", child: 0 }])
  })
})

describe("a student's year", () => {
  it("is the coming intake: this year before April, next year from April", () => {
    expect(defaultYear([2026, 2027], "2026-03-31")).toBe(2026)
    expect(defaultYear([2026, 2027], "2026-04-01")).toBe(2027)
  })

  it("follows the student before until picked", () => {
    expect(yearOf([neema, juma], 1, 2026)).toBe(2027)
    expect(yearOf([juma], 0, 2026)).toBe(2026)
  })
})
