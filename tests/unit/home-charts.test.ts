import { describe, expect, it } from "vitest"

import { classesTab, monthsTab, niceScale, seatsTab, sourcesTab } from "@/app/staff/_home/charts"
import type { ClassSeatFigures } from "@/lib/services/dashboard"
import { APPLICATION_SOURCES, type ApplicationSource, type HomeChartCounts } from "@/lib/services/home-charts"
import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"

// Home's chart card (#405): the tabs and their sentences, from v38's numbers.

function counts({
  classes = {},
  months = [],
  sources = {},
}: {
  classes?: Partial<Record<LeadClass, number>>
  months?: number[]
  sources?: Partial<Record<ApplicationSource, number>>
}): HomeChartCounts {
  const twelve = Array.from({ length: 12 }, (_, i) => months[i] ?? 0)
  return {
    months: twelve,
    classes: LEAD_CLASSES.map((className) => ({ className, count: classes[className] ?? 0 })),
    sources: APPLICATION_SOURCES.map((source) => ({ source, count: sources[source] ?? 0 })),
    total: twelve.reduce((sum, n) => sum + n, 0),
  }
}

// v38's numbers.
const V38 = counts({
  classes: { "DAY CARE": 6, "KG 1": 9, "KG 2": 11, "STD 1": 18, "STD 2": 8, "STD 3": 7, "STD 4": 9, "STD 5": 6, "STD 6": 12, "STD 7": 5, "FORM 1": 21, "FORM 2": 7, "FORM 3": 3, "FORM 4": 2 },
  months: [4, 6, 9, 14, 11, 8, 10, 16, 21, 18, 11],
  sources: { admission_form: 74, agent_code: 31, promo_code: 12, walk_in: 11 },
})
const NONE = counts({})

function seat(className: LeadClass, seats: number | null, taken: number, dayOrBoarding: "Day" | "Boarding" = "Day"): ClassSeatFigures {
  return {
    className,
    dayOrBoarding,
    seats,
    taken,
    full: taken,
    firstInstalment: 0,
    deposit: 0,
    left: seats === null ? null : Math.max(seats - taken, 0),
    overBy: seats !== null && taken > seats ? taken - seats : null,
  }
}

describe("Classes", () => {
  it("names the two classes with the most students, as v38 does", () => {
    expect(classesTab(V38)?.heading).toBe("FORM 1 and STD 1 draw the most students")
  })

  it("names one class when only one has any", () => {
    expect(classesTab(counts({ classes: { "KG 2": 3 }, months: [3] }))?.heading).toBe("KG 2 draws the most students")
  })

  it("draws every class, zeros included, with short labels and the tooltip's words", () => {
    const tab = classesTab(V38)!
    expect(tab.points.map((point) => point.short)).toEqual(["DC", "KG1", "KG2", "1", "2", "3", "4", "5", "6", "7", "1", "2", "3", "4"])
    expect(tab.points[10].tip).toEqual({ number: "21", words: "FORM 1 · students" })
  })

  it("groups the axis Nursery / STD / FORM", () => {
    expect(classesTab(V38)!.groups).toEqual([
      { label: "Nursery", short: "Nursery", span: 3 },
      { label: "Primary · STD", short: "STD", span: 7 },
      { label: "Secondary · FORM", short: "FORM", span: 4 },
    ])
  })

  it("is left out when no one has applied this year", () => {
    expect(classesTab(NONE)).toBeNull()
  })
})

describe("Months", () => {
  it("names the busiest month, as v38 does", () => {
    expect(monthsTab(V38, "2026-11-15")?.heading).toBe("September was the busiest month, with 21 applications")
  })

  it("draws January to the month running, which is lighter and says so", () => {
    const tab = monthsTab(V38, "2026-11-15")!
    expect(tab.points.map((point) => point.short)).toEqual(["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"])
    expect(tab.points.filter((point) => point.part).map((point) => point.label)).toEqual(["November"])
    expect(tab.note).toBe("November so far, shown lighter.")
    expect(tab.points[10].tip).toEqual({ number: "11", words: "November so far · applications" })
    expect(tab.points[8].tip).toEqual({ number: "21", words: "Sep · applications" })
  })

  it("says so far when the month running is the busiest, and counts one application as one", () => {
    expect(monthsTab(counts({ months: [1] }), "2027-01-04")?.heading).toBe("January is the busiest month so far, with 1 application")
  })

  it("gives a tie to the earlier month", () => {
    expect(monthsTab(counts({ months: [5, 5, 2] }), "2026-03-10")?.heading).toBe("January was the busiest month, with 5 applications")
  })

  it("is left out when no one has applied this year", () => {
    expect(monthsTab(NONE, "2026-11-15")).toBeNull()
  })
})

describe("Seats", () => {
  const V38_SEATS = [seat("DAY CARE", 15, 9), seat("KG 2", 25, 18), seat("STD 1", 40, 31), seat("STD 4", 30, 22), seat("STD 6", 35, 35), seat("FORM 1", 60, 44)]

  it("names the full class and the one with the most free seats, as v38 does", () => {
    expect(seatsTab(V38_SEATS)?.heading).toBe("STD 6 is full. FORM 1 has the most free seats, 16")
  })

  it("puts N free or Full on each capsule, and the tooltip's words", () => {
    const tab = seatsTab(V38_SEATS)!
    expect(tab.points.map((point) => [point.short, point.full ? "Full" : `${point.seats - point.value} free`])).toEqual([
      ["DC", "6 free"],
      ["KG 2", "7 free"],
      ["STD 1", "9 free"],
      ["STD 4", "8 free"],
      ["STD 6", "Full"],
      ["FORM 1", "16 free"],
    ])
    expect(tab.points[4].tip).toEqual({ number: "35 of 35", words: "STD 6 · Full" })
    expect(tab.points[5].tip).toEqual({ number: "44 of 60", words: "FORM 1 · 16 free" })
  })

  it("adds Day and Boarding together, and leaves out a class with no seats set", () => {
    const tab = seatsTab([seat("FORM 1", 20, 20), seat("FORM 1", 10, 4, "Boarding"), seat("FORM 2", null, 3)])!
    expect(tab.points).toHaveLength(1)
    expect(tab.points[0]).toMatchObject({ label: "FORM 1", seats: 30, value: 24, full: false })
    expect(tab.heading).toBe("FORM 1 has the most free seats, 6")
  })

  it("leaves out a class holding seats in a section with no seats set, since its free seats are not known", () => {
    const tab = seatsTab([seat("FORM 1", 20, 15), seat("FORM 1", null, 5, "Boarding"), seat("FORM 2", 10, 4), seat("FORM 2", null, 0, "Boarding")])!
    expect(tab.points.map((point) => point.label)).toEqual(["FORM 2"])
    expect(tab.heading).toBe("FORM 2 has the most free seats, 6")
  })

  it("shows a class set to zero seats as Full", () => {
    const tab = seatsTab([seat("FORM 4", 0, 0), seat("FORM 3", 10, 3)])!
    expect(tab.points[0]).toMatchObject({ label: "FORM 4", full: true, fill: 100, tip: { number: "0 of 0", words: "FORM 4 · Full" } })
    expect(tab.heading).toBe("FORM 4 is full. FORM 3 has the most free seats, 7")
  })

  it("keeps an over-full class full, its capsule filled to the top", () => {
    const tab = seatsTab([seat("STD 6", 10, 12), seat("STD 7", 10, 2)])!
    expect(tab.points[0]).toMatchObject({ full: true, fill: 100 })
    expect(tab.heading).toBe("STD 6 is full. STD 7 has the most free seats, 8")
  })

  it("names two full classes, counts more, and says when every class is full", () => {
    expect(seatsTab([seat("STD 5", 5, 5), seat("STD 6", 5, 5), seat("STD 7", 5, 1)])?.heading).toBe("STD 5 and STD 6 are full. STD 7 has the most free seats, 4")
    expect(seatsTab([seat("STD 4", 5, 5), seat("STD 5", 5, 5), seat("STD 6", 5, 5), seat("STD 7", 5, 1)])?.heading).toBe(
      "3 classes are full. STD 7 has the most free seats, 4",
    )
    expect(seatsTab([seat("STD 5", 5, 5), seat("STD 6", 5, 6), seat("STD 7", 5, 5)])?.heading).toBe("Every class is full")
    expect(seatsTab([seat("STD 6", 5, 5)])?.heading).toBe("STD 6 is full")
  })

  it("is left out when no class has seats set", () => {
    expect(seatsTab([seat("STD 1", null, 2)])).toBeNull()
    expect(seatsTab([])).toBeNull()
  })
})

describe("Sources", () => {
  it("says most families apply through the Admission form, as v38 does", () => {
    expect(sourcesTab(V38)?.heading).toBe("Most families apply through the Admission form")
  })

  it("lists the four sources with number and percent, and the total for the middle", () => {
    const tab = sourcesTab(V38)!
    expect(tab.total).toBe(128)
    expect(tab.points.map((point) => [point.label, point.value, point.percent])).toEqual([
      ["Admission form", 74, 58],
      ["Agents’ Discount codes", 31, 24],
      ["Promo codes", 12, 9],
      ["Walk-in at the desk", 11, 9],
    ])
    expect(tab.points[0].tip).toEqual({ number: "74 · 58%", words: "Admission form" })
  })

  it("names whichever source is largest", () => {
    const at = (sources: Partial<Record<ApplicationSource, number>>) =>
      sourcesTab(counts({ months: [Object.values(sources).reduce((sum, n) => sum + n, 0)], sources }))?.heading
    expect(at({ agent_code: 3, admission_form: 1 })).toBe("Most families apply with an agent’s Discount code")
    expect(at({ promo_code: 3 })).toBe("Most families apply with a Promo code")
    expect(at({ walk_in: 3, promo_code: 1 })).toBe("Most families apply at the desk")
  })

  it("is left out when no one has applied this year", () => {
    expect(sourcesTab(NONE)).toBeNull()
  })
})

describe("niceScale", () => {
  it("rounds the top up to at most five steps", () => {
    expect(niceScale(21)).toEqual({ top: 25, step: 5 })
    expect(niceScale(3)).toEqual({ top: 3, step: 1 })
    expect(niceScale(0)).toEqual({ top: 1, step: 1 })
    expect(niceScale(130)).toEqual({ top: 150, step: 50 })
    expect(niceScale(4200)).toEqual({ top: 5000, step: 1000 })
  })
})
