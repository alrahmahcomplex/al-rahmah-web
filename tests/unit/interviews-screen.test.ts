import { describe, expect, it } from "vitest"

import { defaultInterviewYear, interviewsHref, parseInterviewSearch } from "@/app/staff/interviews/search-params"
import { navFor, STAFF_NAV } from "@/app/staff/navigation"

describe("parseInterviewSearch", () => {
  it("reads the year, the filters and the page from the URL", () => {
    expect(parseInterviewSearch({ year: "2027", result: "passed", fee: "not-paid", page: "2" })).toEqual({
      enrollmentYear: 2027,
      result: "Passed",
      feeStatus: "Not Paid",
      page: 2,
    })
    expect(parseInterviewSearch({ result: "none", fee: "paid" })).toMatchObject({ result: "none", feeStatus: "Paid" })
    expect(parseInterviewSearch({ result: "failed" }).result).toBe("Failed")
  })

  it("leaves the year to the screen, and drops unknown filters and pages, for anything unreadable", () => {
    const everything = { enrollmentYear: undefined, result: undefined, feeStatus: undefined, page: 1 }
    expect(parseInterviewSearch({})).toEqual(everything)
    expect(parseInterviewSearch({ year: "27", result: "Passed", fee: "Paid", page: "0" })).toEqual(everything)
    expect(parseInterviewSearch({ year: "1999" }).enrollmentYear).toBeUndefined()
    expect(parseInterviewSearch({ year: "2101" }).enrollmentYear).toBeUndefined()
    expect(parseInterviewSearch({ year: "2027.5" }).enrollmentYear).toBeUndefined()
    expect(parseInterviewSearch({ page: "2.5" }).page).toBe(1)
    expect(parseInterviewSearch({ page: "10001" }).page).toBe(1)
    expect(parseInterviewSearch({ page: "10000" }).page).toBe(10_000)
  })

  it("takes the first value of a repeated parameter", () => {
    expect(parseInterviewSearch({ year: ["2028", "2027"], fee: ["paid", "not-paid"] })).toMatchObject({
      enrollmentYear: 2028,
      feeStatus: "Paid",
    })
  })
})

describe("interviewsHref", () => {
  const search = { enrollmentYear: 2027, page: 1 }

  it("always names the year, and leaves out the first page and absent filters", () => {
    expect(interviewsHref(search)).toBe("/staff/interviews?year=2027")
  })

  it("writes back what parseInterviewSearch reads", () => {
    const full = { enrollmentYear: 2028, result: "none", feeStatus: "Not Paid", page: 3 } as const
    const href = interviewsHref(full)
    expect(href).toBe("/staff/interviews?year=2028&result=none&fee=not-paid&page=3")
    expect(parseInterviewSearch(Object.fromEntries(new URL(href, "http://x").searchParams))).toEqual(full)
  })

  it("applies changes over the search", () => {
    expect(interviewsHref({ ...search, result: "Passed", page: 4 }, { feeStatus: "Paid", page: 1 })).toBe(
      "/staff/interviews?year=2027&result=passed&fee=paid",
    )
    expect(interviewsHref({ ...search, result: "Failed" }, { result: undefined })).toBe("/staff/interviews?year=2027")
  })
})

describe("defaultInterviewYear", () => {
  it("opens on the current year when it has registrations", () => {
    expect(defaultInterviewYear([2026, 2027], 2026)).toBe(2026)
  })

  it("otherwise opens on the next year that has registrations", () => {
    expect(defaultInterviewYear([2025, 2028, 2027], 2026)).toBe(2027)
  })

  it("otherwise opens on the latest year, and on the current year with none at all", () => {
    expect(defaultInterviewYear([2023, 2025], 2026)).toBe(2025)
    expect(defaultInterviewYear([], 2026)).toBe(2026)
  })
})

describe("the Interviews navigation entry", () => {
  it("shows Interviews to anyone who may view leads, and to no one else", () => {
    const interviews = STAFF_NAV.find((entry) => entry.label === "Interviews")
    expect(interviews).toEqual({ href: "/staff/interviews", label: "Interviews", permission: "leads.view" })
    expect(navFor(["leads.view"])).toContain(interviews)
    expect(navFor(["payments.view", "interview_payments.record"])).not.toContain(interviews)
  })
})
