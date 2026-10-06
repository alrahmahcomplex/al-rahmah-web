import { describe, expect, it } from "vitest"

import { differingText, displayPhone } from "@/app/staff/re-applications/format"
import { parseReApplicationSearch, reApplicationsHref } from "@/app/staff/re-applications/search-params"

describe("the Re-applications screen's URL", () => {
  it("starts on the first page of the unreviewed ones", () => {
    expect(parseReApplicationSearch({})).toEqual({ filter: "unreviewed", page: 1 })
    expect(reApplicationsHref({ filter: "unreviewed", page: 1 })).toBe("/staff/re-applications")
  })

  it("keeps Show reviewed and the page", () => {
    const search = parseReApplicationSearch({ reviewed: "1", page: "3" })
    expect(search).toEqual({ filter: "reviewed", page: 3 })
    expect(reApplicationsHref(search)).toBe("/staff/re-applications?reviewed=1&page=3")
    expect(reApplicationsHref(search, { filter: "unreviewed", page: 1 })).toBe("/staff/re-applications")
  })

  it("reads a page that isn't a whole number from 1 up, or is far past any list, as the first", () => {
    for (const page of ["0", "-2", "1.5", "abc", "10001"]) {
      expect(parseReApplicationSearch({ page }).page).toBe(1)
    }
  })
})

describe("the Re-applications screen's wording", () => {
  it("counts the fields that differ", () => {
    expect(differingText(0)).toBe("Nothing differs")
    expect(differingText(1)).toBe("1 field differs")
    expect(differingText(3)).toBe("3 fields differ")
  })

  it("spaces a stored Tanzanian number, and leaves any other as it is", () => {
    expect(displayPhone("+255700000301")).toBe("+255 700 000 301")
    expect(displayPhone("+447700900123")).toBe("+447700900123")
  })
})
