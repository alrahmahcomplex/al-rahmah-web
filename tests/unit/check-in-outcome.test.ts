import { describe, expect, it } from "vitest"

import { refusalOutcome } from "@/app/staff/check-in/outcome"
import { enrollmentYears, formatDate, tanzaniaToday } from "@/lib/school-calendar"

describe("refusalOutcome", () => {
  it("sends staff back to the parent step, with a clear message, for a phone the database cannot read", () => {
    const outcome = refusalOutcome({ kind: "invalid", field: "phone" })
    expect(outcome).toMatchObject({ status: "refused", step: "parent", field: "phone" })
    expect(outcome.status === "refused" && outcome.message).toMatch(/phone number can't be read/)
  })

  it("sends a student field back to the student step", () => {
    expect(refusalOutcome({ kind: "invalid", field: "visit_date" })).toMatchObject({ step: "student" })
    expect(refusalOutcome({ kind: "invalid", field: "enrollment_year" })).toMatchObject({ step: "student" })
  })

  it("keeps an unnamed refusal on the review step", () => {
    expect(refusalOutcome({ kind: "invalid", field: null })).toMatchObject({ step: "review", field: null })
    expect(refusalOutcome({ kind: "unavailable" })).toMatchObject({ status: "refused", step: "review" })
    expect(refusalOutcome({ kind: "forbidden" })).toMatchObject({ status: "refused", step: "review" })
  })

  it("links an open duplicate to the lead", () => {
    const lead = { id: "abc", admissionNumber: "ADMSN-12345", status: "Visited", closure: null } as const
    expect(refusalOutcome({ kind: "duplicate", lead })).toEqual({
      status: "duplicate",
      admissionNumber: "ADMSN-12345",
      href: "/staff/leads/abc",
    })
  })

  it("links a closed duplicate to the Reopening request hand-off", () => {
    const archived = { id: "abc", admissionNumber: "ADMSN-12345", status: "Visited", closure: "Archived" } as const
    const declined = { id: "def", admissionNumber: "ADMSN-54321", status: "Declined", closure: null } as const
    expect(refusalOutcome({ kind: "duplicate", lead: archived })).toMatchObject({
      href: "/staff/leads/abc/reopen?source=duplicate_match",
    })
    expect(refusalOutcome({ kind: "duplicate", lead: declined })).toMatchObject({
      href: "/staff/leads/def/reopen?source=duplicate_match",
    })
  })
})

describe("the school calendar", () => {
  it("says today in Tanzania time, which is ahead of UTC", () => {
    // 22:30 UTC on 30 September is already 1 October at 01:30 in Tanzania.
    expect(tanzaniaToday(new Date("2026-09-30T22:30:00Z"))).toBe("2026-10-01")
    expect(tanzaniaToday(new Date("2026-09-30T20:30:00Z"))).toBe("2026-09-30")
  })

  it("offers the current year and the next two", () => {
    expect(enrollmentYears(new Date("2026-09-29T10:00:00Z"))).toEqual([2026, 2027, 2028])
    expect(enrollmentYears(new Date("2026-12-31T22:00:00Z"))).toEqual([2027, 2028, 2029])
  })

  it("writes a date the way a reader says it", () => {
    expect(formatDate("2026-09-29")).toBe("29 Sept 2026")
  })
})
