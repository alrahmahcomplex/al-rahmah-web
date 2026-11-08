import { describe, expect, it } from "vitest"

import { childrenProblem, childrenProblems, parentProblem, parentProblems, remainingDuplicates } from "@/lib/admission-form"
import type { NewStudent } from "@/lib/services/leads"

const YEARS = [2026, 2027]

const EMPTY_PARENT = { fullName: "", relationship: "" as never, phone: "" }
const EMPTY_CHILD = { fullName: "", className: "" as never, enrollmentYear: 0, dayOrBoarding: "" as never }
const CHILD: NewStudent = { fullName: "Zawadi Fixture", className: "STD 2", enrollmentYear: 2027, dayOrBoarding: "Day" }

describe("every problem on the parent step", () => {
  it("names each missing field at once, in the order the fields show", () => {
    expect(parentProblems(EMPTY_PARENT).map((p) => p.field)).toEqual(["contact_name", "relationship", "phone"])
  })

  it("asks for the description only once Other is picked", () => {
    const other = { fullName: "Amina", relationship: "Other" as const, relationshipDescription: " ", phone: "" }
    expect(parentProblems(other).map((p) => p.field)).toEqual(["relationship_description", "phone"])
  })

  it("is empty for a complete parent, and the server's single problem is still the first", () => {
    expect(parentProblems({ fullName: "Amina", relationship: "Mother", phone: "0700 000 900" })).toEqual([])
    expect(parentProblem(EMPTY_PARENT)).toEqual({ field: "contact_name", child: null })
  })
})

describe("every problem across the child cards", () => {
  it("names each card's missing fields, card by card", () => {
    const problems = childrenProblems([EMPTY_CHILD, { ...CHILD, className: "" as never, dayOrBoarding: "" as never }], YEARS)
    expect(problems).toEqual([
      { field: "student_name", child: 0 },
      { field: "class_name", child: 0 },
      { field: "enrollment_year", child: 0 },
      { field: "day_or_boarding", child: 0 },
      { field: "class_name", child: 1 },
      { field: "day_or_boarding", child: 1 },
    ])
  })

  it("names a repeated child on the later card, alongside its other problems", () => {
    const problems = childrenProblems([CHILD, { ...CHILD, fullName: " zawadi  FIXTURE", enrollmentYear: 2030 }], YEARS)
    expect(problems).toEqual([
      { field: "enrollment_year", child: 1 },
      { field: "duplicate_child", child: 1 },
    ])
  })

  it("never calls two unnamed cards the same child", () => {
    expect(childrenProblems([EMPTY_CHILD, EMPTY_CHILD], YEARS).some((p) => p.field === "duplicate_child")).toBe(false)
  })

  it("keeps the count problem on its own, and the server's single problem first", () => {
    expect(childrenProblems([], YEARS)).toEqual([{ field: "children", child: null }])
    expect(childrenProblem([CHILD, EMPTY_CHILD], YEARS)).toEqual({ field: "student_name", child: 1 })
    expect(childrenProblem([CHILD], YEARS)).toBeNull()
  })
})

describe("repeated-child warnings after a name edit", () => {
  const named = (...names: string[]) => names.map((fullName) => ({ ...CHILD, fullName }))

  it("keeps the third card's warning when the second of A, A, A is renamed", () => {
    expect(remainingDuplicates(named("A", "B", "A"), new Set([1, 2]))).toEqual([{ field: "duplicate_child", child: 2 }])
  })

  it("keeps the third card's warning when the first is renamed: it still repeats the second", () => {
    expect(remainingDuplicates(named("B", "A", "A"), new Set([1, 2]))).toEqual([{ field: "duplicate_child", child: 2 }])
  })

  it("clears every warning once no names repeat", () => {
    expect(remainingDuplicates(named("A", "B", "C"), new Set([1, 2]))).toEqual([])
  })

  it("adds no warning to a card that wasn't showing one", () => {
    expect(remainingDuplicates(named("A", "B", "B"), new Set([1]))).toEqual([])
    expect(remainingDuplicates(named("A", "A"), new Set())).toEqual([])
  })
})
