import { describe, expect, it } from "vitest"

import { leadsHref, parseLeadSearch } from "@/app/staff/leads/search-params"

describe("parseLeadSearch", () => {
  it("reads the search box, the filters and the page from the URL", () => {
    expect(parseLeadSearch({ q: " Amina ", status: "Declined", closure: "Archived", page: "3" })).toEqual({
      query: "Amina",
      status: "Declined",
      closure: "Archived",
      page: 1 + 2,
    })
  })

  it("falls back to the everyday list for anything missing or unknown", () => {
    const everyday = { query: undefined, status: undefined, closure: "open", page: 1 }
    expect(parseLeadSearch({})).toEqual(everyday)
    expect(parseLeadSearch({ q: "   ", status: "Lost", closure: "gone", page: "0" })).toEqual(everyday)
    expect(parseLeadSearch({ page: "-2" }).page).toBe(1)
    expect(parseLeadSearch({ page: "2.5" }).page).toBe(1)
    expect(parseLeadSearch({ page: "abc" }).page).toBe(1)
    // Past any real list, and large enough to overflow the database offset.
    expect(parseLeadSearch({ page: "1e308" }).page).toBe(1)
    expect(parseLeadSearch({ page: "10001" }).page).toBe(1)
    expect(parseLeadSearch({ page: "10000" }).page).toBe(10_000)
  })

  it("takes the first value of a repeated parameter", () => {
    expect(parseLeadSearch({ q: ["Neema", "Baraka"], status: ["Visited", "Applied"] })).toMatchObject({
      query: "Neema",
      status: "Visited",
    })
  })
})

describe("leadsHref", () => {
  it("leaves out defaults, so the everyday list is a plain /staff/leads", () => {
    expect(leadsHref({ closure: "open", page: 1 })).toBe("/staff/leads")
  })

  it("keeps the filters when paging", () => {
    expect(leadsHref({ status: "Visited", closure: "Inactive", page: 1 }, { page: 2 })).toBe(
      "/staff/leads?status=Visited&closure=Inactive&page=2",
    )
  })

  it("keeps the search term when paging, encoded", () => {
    expect(leadsHref({ query: "Amina & Juma", closure: "open", page: 2 }, { page: 3 })).toBe(
      "/staff/leads?q=Amina+%26+Juma&page=3",
    )
  })
})

describe("the earlier group link filter", () => {
  it("reads an Enrollment year and keeps it in the URL", () => {
    expect(parseLeadSearch({ earlier_link: "2027" }).earlierLinkYear).toBe(2027)
    expect(leadsHref({ closure: "open", earlierLinkYear: 2027, page: 1 }, { page: 2 })).toBe(
      "/staff/leads?earlier_link=2027&page=2",
    )
  })

  it("ignores anything that isn't a year", () => {
    for (const value of ["", "27", "1999", "2027x", "abcd"]) {
      expect(parseLeadSearch({ earlier_link: value }).earlierLinkYear).toBeUndefined()
    }
  })
})
