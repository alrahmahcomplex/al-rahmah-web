import { describe, expect, it } from "vitest"

import { ALL_TIME, anchorFor, panelHref, parsePanelFilters, periodLabel } from "@/app/staff/_dashboard/filters"

describe("parsePanelFilters", () => {
  it("reads one panel's period and Enrollment year from its own keys", () => {
    expect(parsePanelFilters({ visited: "week:2026-09-21", visited_year: "2027", other: "year:2025-01-01" }, "visited")).toEqual({
      period: { kind: "week", anchor: "2026-09-21" },
      enrollmentYear: 2027,
    })
  })

  it("falls back to All time and All years for anything missing or unreadable", () => {
    expect(parsePanelFilters({}, "visited")).toEqual(ALL_TIME)
    for (const visited of ["all", "fortnight:2026-09-21", "week", "week:", "week:2026-02-30", "date:21-09-2026", "date:1999-12-31"]) {
      expect(parsePanelFilters({ visited }, "visited").period).toEqual({ kind: "all" })
    }
    for (const year of ["", "twenty", "27", "2027.5", "1999", "2101"]) {
      expect(parsePanelFilters({ visited_year: year }, "visited").enrollmentYear).toBeNull()
    }
  })

  it("takes the first value of a repeated key", () => {
    expect(parsePanelFilters({ visited: ["date:2026-09-01", "year:2025-01-01"] }, "visited").period).toEqual({
      kind: "date",
      anchor: "2026-09-01",
    })
  })
})

describe("panelHref", () => {
  it("changes one panel's keys and keeps every other panel's", () => {
    const current = new URLSearchParams("interviewed=month:2026-09-01&visited=all")
    expect(panelHref(current, "visited", { period: { kind: "date", anchor: "2026-09-21" }, enrollmentYear: 2031 })).toBe(
      "/staff?interviewed=month%3A2026-09-01&visited=date%3A2026-09-21&visited_year=2031",
    )
  })

  it("leaves the defaults out of the address", () => {
    expect(panelHref(new URLSearchParams("visited=week:2026-09-21&visited_year=2027"), "visited", ALL_TIME)).toBe("/staff")
  })
})

describe("anchorFor", () => {
  it("starts a new period on the one containing the given day", () => {
    // 1 Oct 2026 is a Thursday.
    expect(anchorFor("date", "2026-10-01")).toBe("2026-10-01")
    expect(anchorFor("week", "2026-10-01")).toBe("2026-09-28")
    expect(anchorFor("week", "2026-09-27")).toBe("2026-09-21")
    expect(anchorFor("week", "2026-09-28")).toBe("2026-09-28")
    expect(anchorFor("month", "2026-10-01")).toBe("2026-10-01")
    expect(anchorFor("month", "2026-02-14")).toBe("2026-02-01")
    expect(anchorFor("year", "2026-10-01")).toBe("2026-01-01")
  })
})

describe("periodLabel", () => {
  it("names the period a panel shows", () => {
    expect(periodLabel({ kind: "all" })).toBe("All time")
    // Dates read the way the rest of the staff side writes them.
    expect(periodLabel({ kind: "date", anchor: "2026-09-21" })).toBe("21 Sept 2026")
    // A week is named by its Monday, whichever day anchors it.
    expect(periodLabel({ kind: "week", anchor: "2026-09-24" })).toBe("Week of 21 Sept 2026")
    expect(periodLabel({ kind: "week", anchor: "2026-01-01" })).toBe("Week of 29 Dec 2025")
    expect(periodLabel({ kind: "month", anchor: "2026-09-15" })).toBe("September 2026")
    expect(periodLabel({ kind: "year", anchor: "2026-01-01" })).toBe("2026")
  })
})
