import { describe, expect, it } from "vitest"

import { classesTab, monthLine, monthsTab, niceScale, RING, ringSlices, seatsTabOf, slicePath, sourcesTab, statusTab, type SeatsTabClass } from "@/app/staff/_home/charts"
import { APPLICATION_SOURCES, type ApplicationSource, type HomeChartCounts } from "@/lib/services/home-charts"
import { LEAD_CLASSES, LEAD_STATUSES, type LeadClass, type LeadStatus } from "@/lib/services/leads"

// Home's chart card (#405, #518), as the owner's chart-card prototype
// (24tWDhYZ28Qs6CsJowG1h9) draws it.

// `months` are consecutive months from `from` (YYYY-MM). A month with none is
// left out, as the database leaves it out.
function counts({
  classes = {},
  months = [],
  from = "2026-01",
  sources = {},
  statuses = {},
}: {
  classes?: Partial<Record<LeadClass, number>>
  months?: number[]
  from?: string
  sources?: Partial<Record<ApplicationSource, number>>
  statuses?: Partial<Record<LeadStatus, number>>
}): HomeChartCounts {
  const [y, m] = from.split("-").map(Number)
  const rows = months.flatMap((count, i) => {
    const at = new Date(Date.UTC(y, m - 1 + i, 1))
    return count > 0 ? [{ month: `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`, count }] : []
  })
  return {
    months: rows,
    classes: LEAD_CLASSES.map((className) => ({ className, count: classes[className] ?? 0 })),
    statuses: LEAD_STATUSES.map((status) => ({ status, count: statuses[status] ?? 0 })),
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

const seat = (className: LeadClass, seats: number, paid: number, partial: number): SeatsTabClass => {
  const free = Math.max(0, seats - paid - partial)
  return { className, seats, paid, partial, free, full: free === 0 }
}

describe("Classes", () => {
  it("draws every class, zeros included, named in full, with the tooltip's words", () => {
    const tab = classesTab(V38)!
    expect(tab.points.map((point) => point.short)).toEqual([...LEAD_CLASSES])
    expect(tab.points[10].tip).toEqual({ number: "21", words: "FORM 1 · students" })
  })

  it("is left out when no one has applied this year", () => {
    expect(classesTab(NONE)).toBeNull()
  })
})

describe("Months", () => {
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

  it("always has the twelve months, January first, and runs the line from January to the month running", () => {
    const tab = monthsTab(V38, "2026-11-15", true)!
    expect(tab.points.map((point) => point.short)).toEqual(MONTHS)
    expect(tab.drawn).toBe(11)
    expect(tab.points.filter((point) => point.part).map((point) => point.label)).toEqual(["November"])
    expect(tab.points[10].tip).toEqual({ number: "11", words: "November so far · applications" })
    expect(tab.points[8].tip).toEqual({ number: "21", words: "September · applications" })
  })

  it("draws a month with none as zero from January, as the line starts there", () => {
    const tab = monthsTab(counts({ months: [3, 0, 2], from: "2026-06" }), "2026-09-01", true)!
    expect(tab.drawn).toBe(9)
    expect(tab.points.slice(0, 9).map((point) => point.value)).toEqual([0, 0, 0, 0, 0, 3, 0, 2, 0])
  })

  it("adds the same month of different calendar years together, so every applicant is counted", () => {
    // 2026's applicants: from June 2025 to May 2026, and one late in September 2026.
    const year = counts({ months: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 0, 0, 0, 2], from: "2025-06" })
    const tab = monthsTab(year, "2026-11-15", false)!
    expect(tab.points.map((point) => point.value)).toEqual([11, 12, 13, 14, 15, 4, 5, 6, 7 + 2, 8, 9, 10])
    expect(tab.points.reduce((sum, point) => sum + point.value, 0)).toBe(year.total)
  })

  it("runs through all twelve months once the year is over, with nothing lighter", () => {
    const tab = monthsTab(counts({ months: [8, 14, 0, 2], from: "2025-07" }), "2026-11-15", false)!
    expect(tab.drawn).toBe(12)
    expect(tab.points.some((point) => point.part)).toBe(false)
  })

  it("runs on past the month running to a later month that already has applicants", () => {
    // The admission year 2027 in February 2027: applicants since June 2026.
    const tab = monthsTab(counts({ months: [3, 4, 5, 6, 7, 8, 9, 1, 2], from: "2026-06" }), "2027-02-10", true)!
    expect(tab.drawn).toBe(12)
    expect(tab.points.filter((point) => point.part).map((point) => point.label)).toEqual(["February"])
  })

  it("is left out when no one has applied for the year", () => {
    expect(monthsTab(NONE, "2026-11-15", true)).toBeNull()
  })
})

describe("Status", () => {
  it("draws every status from Applied to Enrolled and Declined, zeros included", () => {
    const tab = statusTab(counts({ months: [3], statuses: { Applied: 2, Enrolled: 1 } }))!
    expect(tab.points.map((point) => [point.label, point.value])).toEqual([
      ["Applied", 2],
      ["Visited", 0],
      ["Interviewed", 0],
      ["Enrolled", 1],
      ["Declined", 0],
    ])
    expect(tab.points[3].tip).toEqual({ number: "1", words: "Enrolled · applicants" })
  })

  it("is left out when no one has applied for the year", () => {
    expect(statusTab(NONE)).toBeNull()
  })
})

describe("Seats", () => {
  it("holds each class's paid and part-paid seats, its free seats, and the tooltip's words", () => {
    const tab = seatsTabOf([seat("DAY CARE", 20, 9, 5), seat("STD 6", 35, 30, 5)])!
    expect(tab.points.map((point) => [point.short, point.value, point.paid, point.partial, point.free, point.full])).toEqual([
      ["DAY CARE", 14, 9, 5, 6, false],
      ["STD 6", 35, 30, 5, 0, true],
    ])
    expect(tab.points[0].tip).toEqual({ number: "14 of 20", words: "DAY CARE · 9 paid in full, 5 partial payment" })
  })

  it("shows a class set to zero seats as Full", () => {
    expect(seatsTabOf([seat("FORM 4", 0, 0, 0)])!.points[0]).toMatchObject({ full: true, value: 0, tip: { number: "0 of 0" } })
  })

  it("is left out when no class has streams", () => {
    expect(seatsTabOf([])).toBeNull()
  })
})

describe("Sources", () => {
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
  const around = 2 * Math.PI
  const inner = RING.radius - RING.width / 2 + RING.corner
  // The least a slice takes: its gap, its two corners on the inside edge, and a sliver.
  const least = RING.gap / RING.radius + (2 * RING.corner) / inner + 2 / RING.radius

  it("gives each source its true share of the ring, slice after slice all the way round", () => {
    const values = [74, 31, 12, 11]
    const { full, slices } = ringSlices(values)
    expect(full).toBeNull()
    expect(slices.map((slice) => slice.index)).toEqual([0, 1, 2, 3])
    slices.forEach((slice, i) => expect(slice.end - slice.start).toBeCloseTo((values[i] / 128) * around, 6))
    slices.forEach((slice, i) => expect(slice.start).toBeCloseTo(i === 0 ? 0 : slices[i - 1].end, 9))
    expect(slices.at(-1)!.end).toBeCloseTo(around, 9)
  })

  it("leaves out a source with no applications, and keeps each slice's own shade", () => {
    const { full, slices } = ringSlices([40, 0, 0, 10])
    expect(full).toBeNull()
    expect(slices.map((slice) => slice.index)).toEqual([0, 3])
  })

  it("is one whole ring, in that source's shade, when only one source has applications", () => {
    expect(ringSlices([0, 0, 7, 0])).toEqual({ full: 2, slices: [] })
    expect(ringSlices([5])).toEqual({ full: 0, slices: [] })
  })

  it("gives a source too small to show a thin sliver, taken from the others, and still fills the ring", () => {
    for (const values of [
      [1000, 1],
      [1, 500, 1, 498],
      [2, 38, 9, 52],
      [1, 1, 1, 5000],
    ]) {
      const { slices } = ringSlices(values)
      expect(slices).toHaveLength(values.filter((value) => value > 0).length)
      for (const slice of slices) expect(slice.end - slice.start).toBeGreaterThanOrEqual(least - 1e-9)
      expect(slices.at(-1)!.end).toBeCloseTo(around, 9)
    }
    // The larger sources keep their order of size.
    const [small, large] = ringSlices([1000, 1]).slices.map((slice) => slice.end - slice.start).sort((a, b) => a - b)
    expect(large).toBeGreaterThan(small * 10)
  })

  // The large-arc flags of a slice's outer and inner edges.
  const flags = (d: string) => [...d.matchAll(/A[\d.]+,[\d.]+ 0 (\d) [01] /g)].map((m) => Number(m[1]))

  it("draws a slice as one closed ring piece inside the ring's width", () => {
    const d = slicePath({ index: 0, start: 0, end: Math.PI / 2 })
    expect(d).toMatch(/^M[\d.]+,[\d.]+ A[\d.]+,[\d.]+ 0 0 1 [\d.]+,[\d.]+ L[\d.]+,[\d.]+ A[\d.]+,[\d.]+ 0 0 0 [\d.]+,[\d.]+ Z$/)
    expect(flags(slicePath({ index: 0, start: 0, end: 1.5 * Math.PI }))).toEqual([1, 1])
  })

  it("gives each edge of a slice just over half the ring its own large-arc flag", () => {
    // 53 of 100: the outer edge spans just over π, the inner, pulled in further by its corners, just under.
    const [big] = ringSlices([53, 47, 0, 0]).slices
    expect(flags(slicePath(big))).toEqual([1, 0])
  })
})

describe("the Months line", () => {
  const H = 220
  // Twelve months, evenly along a 600-wide plot.
  const at = (values: number[]) => values.map((value, i) => [((i + 0.5) / 12) * 600, H - value * 10] as const)
  const moves = (d: string) => (d.match(/M/g) ?? []).length
  const pieces = (d: string) => (d.match(/C/g) ?? []).length

  it("is one solid line with its glow when no month is running", () => {
    const line = monthLine(at([1, 2, 3, 4]), -1, H)!
    expect(line.dashed).toBeNull()
    expect([moves(line.solid), pieces(line.solid)]).toEqual([1, 3])
    expect(pieces(line.area)).toBe(3)
  })

  it("runs dashed into the running month when it ends the line, the glow stopping before it", () => {
    const line = monthLine(at([1, 2, 3, 4]), 3, H)!
    expect([moves(line.solid), pieces(line.solid)]).toEqual([1, 2])
    expect(line.dashed).toMatch(/^M[\d.]+,[\d.]+ C/)
    expect(pieces(line.dashed!)).toBe(1)
    expect(pieces(line.area)).toBe(2)
  })

  it("runs dashed into the running month in the middle of the line too, solid again after it", () => {
    // February running, with December's applicants already in: the line runs through December.
    const xy = at([2, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5])
    const line = monthLine(xy, 1, H)!
    // The dashed piece runs from January into February.
    expect(line.dashed!.startsWith(`M${Math.round(xy[0][0] * 10) / 10},`)).toBe(true)
    expect(line.dashed!.endsWith(` ${Math.round(xy[1][0] * 10) / 10},${Math.round(xy[1][1] * 10) / 10}`)).toBe(true)
    expect(pieces(line.dashed!)).toBe(1)
    // The solid line starts again at February and runs on through December: 10 pieces.
    expect(line.solid.startsWith(`M${Math.round(xy[1][0] * 10) / 10},`)).toBe(true)
    expect([moves(line.solid), pieces(line.solid)]).toEqual([1, 10])
    // The glow lies under the whole line, as the running month is not its end.
    expect(pieces(line.area)).toBe(11)
  })

  it("is nothing to draw for a single month", () => {
    expect(monthLine(at([3]), 0, H)).toBeNull()
  })
})
