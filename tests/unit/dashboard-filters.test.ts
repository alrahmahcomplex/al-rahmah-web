import { describe, expect, it } from "vitest"

import {
  ALL_YEARS_PARAM,
  anchorFor,
  defaultPanelFilters,
  isFiltered,
  panelHref,
  parsePanelFilters,
  parseSeatsYear,
  periodLabel,
  seatsHref,
} from "@/app/staff/reports/_dashboard/filters"

const DEFAULT_YEAR = 2027

describe("parsePanelFilters", () => {
  it("reads one panel's period and Enrollment year from its own keys", () => {
    expect(parsePanelFilters({ visited: "week:2026-09-21", visited_year: "2031", other: "year:2025-01-01" }, "visited", DEFAULT_YEAR)).toEqual({
      period: { kind: "week", anchor: "2026-09-21" },
      enrollmentYear: 2031,
    })
  })

  it("reads 'all' as All years", () => {
    expect(parsePanelFilters({ visited_year: ALL_YEARS_PARAM }, "visited", DEFAULT_YEAR)).toEqual({
      period: { kind: "all" },
      enrollmentYear: null,
    })
  })

  it("falls back to All time and the current admission year for anything missing or unreadable", () => {
    expect(parsePanelFilters({}, "visited", DEFAULT_YEAR)).toEqual(defaultPanelFilters(DEFAULT_YEAR))
    for (const visited of ["all", "fortnight:2026-09-21", "week", "week:", "week:2026-02-30", "date:21-09-2026", "date:1999-12-31", "week:2026-09-21:junk"]) {
      expect(parsePanelFilters({ visited }, "visited", DEFAULT_YEAR).period).toEqual({ kind: "all" })
    }
    for (const year of ["", "twenty", "27", "2027.5", "1999", "2101"]) {
      expect(parsePanelFilters({ visited_year: year }, "visited", DEFAULT_YEAR).enrollmentYear).toBe(DEFAULT_YEAR)
    }
  })

  it("takes the first value of a repeated key", () => {
    expect(parsePanelFilters({ visited: ["date:2026-09-01", "year:2025-01-01"] }, "visited", DEFAULT_YEAR).period).toEqual({
      kind: "date",
      anchor: "2026-09-01",
    })
  })
})

describe("panelHref", () => {
  it("changes one panel's keys and keeps every other panel's", () => {
    const current = new URLSearchParams("interviewed=month:2026-09-01&visited=all")
    expect(panelHref(current, "visited", { period: { kind: "date", anchor: "2026-09-21" }, enrollmentYear: 2031 }, DEFAULT_YEAR)).toBe(
      "/staff/reports?interviewed=month%3A2026-09-01&visited=date%3A2026-09-21&visited_year=2031",
    )
  })

  it("writes 'all' for All years and leaves the default admission year out of the address", () => {
    expect(panelHref(new URLSearchParams(), "visited", { period: { kind: "all" }, enrollmentYear: null }, DEFAULT_YEAR)).toBe(
      "/staff/reports?visited_year=all",
    )
    expect(panelHref(new URLSearchParams("visited=week:2026-09-21&visited_year=2031"), "visited", defaultPanelFilters(DEFAULT_YEAR), DEFAULT_YEAR)).toBe(
      "/staff/reports",
    )
  })
})

describe("isFiltered", () => {
  it("treats All time for the default admission year as unfiltered, and All years or another year as filtered", () => {
    expect(isFiltered(defaultPanelFilters(DEFAULT_YEAR), DEFAULT_YEAR)).toBe(false)
    expect(isFiltered({ period: { kind: "all" }, enrollmentYear: null }, DEFAULT_YEAR)).toBe(true)
    expect(isFiltered({ period: { kind: "all" }, enrollmentYear: 2031 }, DEFAULT_YEAR)).toBe(true)
    expect(isFiltered({ period: { kind: "year", anchor: "2026-01-01" }, enrollmentYear: DEFAULT_YEAR }, DEFAULT_YEAR)).toBe(true)
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

describe("the Seats by class year", () => {
  it("reads only its own key, and nothing unreadable", () => {
    expect(parseSeatsYear({ seats_year: "2031", visited_year: "2027" })).toBe(2031)
    expect(parseSeatsYear({ seats_year: ["2027", "2031"] })).toBe(2027)
    for (const seats_year of [undefined, "", "next", "31", "1999", "2101"]) {
      expect(parseSeatsYear({ seats_year })).toBeNull()
    }
  })

  it("changes the year and keeps every other panel's filters", () => {
    expect(seatsHref(new URLSearchParams("visited=month:2026-09-01&seats_year=2027"), 2031)).toBe(
      "/staff/reports?visited=month%3A2026-09-01&seats_year=2031",
    )
  })
})
