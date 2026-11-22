import { describe, expect, it } from "vitest"

import { classesTab, monthsTab, niceScale, RING, ringArcs, seatsTabOf, sourcesTab, type SeatsTabClass } from "@/app/staff/_home/charts"
import { APPLICATION_SOURCES, type ApplicationSource, type HomeChartCounts } from "@/lib/services/home-charts"
import { LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"

// Home's chart card (#405, #518): the tabs and their sentences, from v38's numbers.

// `months` are consecutive months from `from` (YYYY-MM). A month with none is
// left out, as the database leaves it out.
function counts({
  classes = {},
  months = [],
  from = "2026-01",
  sources = {},
}: {
  classes?: Partial<Record<LeadClass, number>>
  months?: number[]
  from?: string
  sources?: Partial<Record<ApplicationSource, number>>
}): HomeChartCounts {
  const [y, m] = from.split("-").map(Number)
  const rows = months.flatMap((count, i) => {
    const at = new Date(Date.UTC(y, m - 1 + i, 1))
    return count > 0 ? [{ month: `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`, count }] : []
  })
  return {
    months: rows,
    classes: LEAD_CLASSES.map((className) => ({ className, count: classes[className] ?? 0 })),
    sources: APPLICATION_SOURCES.map((source) => ({ source, count: sources[source] ?? 0 })),
    total: rows.reduce((sum, row) => sum + row.count, 0),
  }
}

// v38's numbers, January to November 2026, for the admission year 2027.
const V38 = counts({
  classes: { "DAY CARE": 6, "KG 1": 9, "KG 2": 11, "STD 1": 18, "STD 2": 8, "STD 3": 7, "STD 4": 9, "STD 5": 6, "STD 6": 12, "STD 7": 5, "FORM 1": 21, "FORM 2": 7, "FORM 3": 3, "FORM 4": 2 },
  months: [4, 6, 9, 14, 11, 8, 10, 16, 21, 18, 11],
  sources: { admission_form: 74, agent_code: 31, promo_code: 12, walk_in: 11 },
})
const NONE = counts({})

// One class's bar as namedSeatsTab adds it up from the class's streams.
function seat(className: LeadClass, seats: number, held: number): SeatsTabClass {
  return { className, seats, held, full: held >= seats, free: Math.max(0, seats - held) }
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
    expect(monthsTab(V38, "2026-11-15", 2027)?.heading).toBe("September was the busiest month, with 21 applications")
  })

  it("draws June of the year before to the month running, which is lighter and says so", () => {
    const tab = monthsTab(V38, "2026-11-15", 2027)!
    expect(tab.points.map((point) => point.short)).toEqual(["Before Jun", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov"])
    expect(tab.points.filter((point) => point.part).map((point) => point.label)).toEqual(["November"])
    expect(tab.note).toBe("November so far, shown lighter.")
    expect(tab.points.at(-1)!.tip).toEqual({ number: "11", words: "November so far · applications" })
    expect(tab.points[4].tip).toEqual({ number: "21", words: "Sep · applications" })
  })

  it("puts every applicant dated before that June in one first column, so the columns add up to the total", () => {
    const tab = monthsTab(V38, "2026-11-15", 2027)!
    expect(tab.points[0]).toMatchObject({ label: "Before June 2026", value: 4 + 6 + 9 + 14 + 11, early: true })
    expect(tab.points[0].tip).toEqual({ number: "44", words: "Before June 2026 · applications" })
    expect(tab.points.reduce((sum, point) => sum + point.value, 0)).toBe(V38.total)
  })

  it("has no first column when no one is dated before June, and draws a month with none as zero", () => {
    const tab = monthsTab(counts({ months: [3, 0, 2], from: "2026-06" }), "2026-09-01", 2027)!
    expect(tab.points.map((point) => [point.short, point.value])).toEqual([
      ["Jun", 3],
      ["Jul", 0],
      ["Aug", 2],
      ["Sep", 0],
    ])
  })

  it("runs on into the new calendar year, at most twelve months", () => {
    const tab = monthsTab(counts({ months: Array(12).fill(1), from: "2026-06" }), "2027-05-20", 2027)!
    expect(tab.points.map((point) => point.short)).toEqual(["Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar", "Apr", "May"])
    expect(tab.note).toBe("May so far, shown lighter.")
  })

  it("says so far when the month running is the busiest, and counts one application as one", () => {
    expect(monthsTab(counts({ months: [1], from: "2026-06" }), "2026-06-04", 2027)?.heading).toBe("June is the busiest month so far, with 1 application")
  })

  it("gives a tie to the earlier month, and never names the first column", () => {
    expect(monthsTab(counts({ months: [9, 0, 0, 0, 0, 5, 5, 2] }), "2026-08-10", 2027)?.heading).toBe("June was the busiest month, with 5 applications")
  })

  it("is left out when no one has applied for the year", () => {
    expect(monthsTab(NONE, "2026-11-15", 2027)).toBeNull()
  })
})

describe("Seats", () => {
  const V38_SEATS = [seat("DAY CARE", 15, 9), seat("KG 2", 25, 18), seat("STD 1", 40, 31), seat("STD 4", 30, 22), seat("STD 6", 35, 35), seat("FORM 1", 60, 44)]

  it("names the full class and the one with the most free seats, as v38 does", () => {
    expect(seatsTabOf(V38_SEATS)?.heading).toBe("STD 6 is full. FORM 1 has the most free seats, 16")
  })

  it("puts N free or Full on each capsule, and the tooltip's words", () => {
    const tab = seatsTabOf(V38_SEATS)!
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

  it("shows a class set to zero seats as Full", () => {
    const tab = seatsTabOf([seat("FORM 4", 0, 0), seat("FORM 3", 10, 3)])!
    expect(tab.points[0]).toMatchObject({ label: "FORM 4", full: true, fill: 100, tip: { number: "0 of 0", words: "FORM 4 · Full" } })
    expect(tab.heading).toBe("FORM 4 is full. FORM 3 has the most free seats, 7")
  })

  it("keeps an over-full class full, its capsule filled to the top", () => {
    const tab = seatsTabOf([seat("STD 6", 10, 12), seat("STD 7", 10, 2)])!
    expect(tab.points[0]).toMatchObject({ full: true, fill: 100 })
    expect(tab.heading).toBe("STD 6 is full. STD 7 has the most free seats, 8")
  })

  it("names two full classes, counts more, and says when every class is full", () => {
    expect(seatsTabOf([seat("STD 5", 5, 5), seat("STD 6", 5, 5), seat("STD 7", 5, 1)])?.heading).toBe("STD 5 and STD 6 are full. STD 7 has the most free seats, 4")
    expect(seatsTabOf([seat("STD 4", 5, 5), seat("STD 5", 5, 5), seat("STD 6", 5, 5), seat("STD 7", 5, 1)])?.heading).toBe(
      "3 classes are full. STD 7 has the most free seats, 4",
    )
    expect(seatsTabOf([seat("STD 5", 5, 5), seat("STD 6", 5, 6), seat("STD 7", 5, 5)])?.heading).toBe("Every class is full")
    expect(seatsTabOf([seat("STD 6", 5, 5)])?.heading).toBe("STD 6 is full")
  })

  it("is left out when no class has streams", () => {
    expect(seatsTabOf([])).toBeNull()
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

  it("adds Earlier records last, for imported records with no code", () => {
    const tab = sourcesTab(counts({ months: [10], sources: { admission_form: 6, earlier_records: 4 } }))!
    expect(tab.points.map((point) => [point.label, point.value, point.percent])).toEqual([
      ["Admission form", 6, 60],
      ["Agents’ Discount codes", 0, 0],
      ["Promo codes", 0, 0],
      ["Walk-in at the desk", 0, 0],
      ["Earlier records", 4, 40],
    ])
    expect(tab.points[4].tip).toEqual({ number: "4 · 40%", words: "Earlier records" })
  })

  it("names whichever source is largest", () => {
    const at = (sources: Partial<Record<ApplicationSource, number>>) =>
      sourcesTab(counts({ months: [Object.values(sources).reduce((sum, n) => sum + n, 0)], sources }))?.heading
    expect(at({ agent_code: 3, admission_form: 1 })).toBe("Most families apply with an agent’s Discount code")
    expect(at({ promo_code: 3 })).toBe("Most families apply with a Promo code")
    expect(at({ walk_in: 3, promo_code: 1 })).toBe("Most families apply at the desk")
    expect(at({ earlier_records: 3, walk_in: 1 })).toBe("Most applicants are Earlier records")
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

describe("the Sources ring", () => {
  const around = 2 * Math.PI * RING.radius
  // A round end reaches half the stroke's width past its dash.
  const reach = RING.width / 2

  // The space between each arc's round end and the next arc's, all the way round.
  const gaps = (arcs: ReturnType<typeof ringArcs>["arcs"]) => {
    const ends = arcs.map((arc) => ({ from: arc.offset - reach, to: arc.offset + arc.dash + reach }))
    return ends.map((end, i) => {
      const next = ends[(i + 1) % ends.length]
      return (i + 1 === ends.length ? next.from + around : next.from) - end.to
    })
  }

  it("draws one soft-ended arc per source, with the same gap between neighbours all the way round", () => {
    const values = [74, 31, 12, 11]
    const { full, arcs } = ringArcs(values)
    expect(full).toBeNull()
    expect(arcs.map((arc) => arc.index)).toEqual([0, 1, 2, 3])
    for (const gap of gaps(arcs)) expect(gap).toBeCloseTo(RING.gap, 6)
    // Each arc, with its gap, takes its share of the ring.
    arcs.forEach((arc, i) => expect(arc.dash + RING.width + RING.gap).toBeCloseTo((values[i] / 128) * around, 6))
    arcs.forEach((arc) => expect(arc.dash + arc.rest).toBeCloseTo(around, 6))
  })

  it("leaves out a source with no applications, and keeps each arc's own shade", () => {
    const { full, arcs } = ringArcs([40, 0, 0, 10])
    expect(full).toBeNull()
    expect(arcs.map((arc) => arc.index)).toEqual([0, 3])
  })

  it("is one whole ring, in that source's shade, when only one source has applications", () => {
    expect(ringArcs([0, 0, 7, 0])).toEqual({ full: 2, arcs: [] })
    expect(ringArcs([5])).toEqual({ full: 0, arcs: [] })
  })

  it("gives a source too small for its round ends a dot of its own, never drawn over its neighbours", () => {
    for (const values of [
      [1000, 1],
      [1, 500, 1, 498],
      [3, 0, 0, 64],
      [1, 1, 1, 5000],
    ]) {
      const { arcs } = ringArcs(values)
      expect(arcs).toHaveLength(values.filter((value) => value > 0).length)
      for (const arc of arcs) expect(arc.dash).toBeGreaterThan(0)
      // Every gap is the same, so no round end reaches its neighbour.
      for (const gap of gaps(arcs)) expect(gap).toBeCloseTo(RING.gap, 6)
      // The arcs and their gaps still add up to the whole ring.
      expect(arcs.reduce((sum, arc) => sum + arc.dash + RING.width + RING.gap, 0)).toBeCloseTo(around, 6)
    }
    // The larger sources keep their order of size.
    const [small, large] = ringArcs([1000, 1]).arcs.map((arc) => arc.dash).sort((a, b) => a - b)
    expect(large).toBeGreaterThan(small * 100)
  })
})
