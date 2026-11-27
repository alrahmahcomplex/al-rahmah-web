import type { ApplicationSource, HomeChartCounts } from "@/lib/services/home-charts"
import type { LeadClass } from "@/lib/services/leads"

import { smoothLine } from "./spark"

// Home's chart card (#405), as the owner's chart-card prototype
// (24tWDhYZ28Qs6CsJowG1h9, approved 2026-11-27) draws it: what each tab
// draws, worked out from the counts. No sentence sits over a chart; each
// chart shows its own numbers. A tab with nothing to draw is left out, so no
// tab ever needs words for "none yet".

/** One mark on a chart: a column, a dot, a bar, a capsule or a row of the ring's list. */
export type ChartPoint = {
  /** The name in full, for the tooltip. */
  label: string
  /** The label under the mark. */
  short: string
  value: number
  /** Drawn lighter: the month still running. */
  part?: boolean
  /** The tooltip: the number in bold, what it is underneath. */
  tip: { number: string; words: string }
}

export type ClassesTab = { kind: "classes"; points: ChartPoint[] }
/** All twelve months, January first; the line runs through the first `drawn` of them. */
export type MonthsTab = { kind: "months"; points: ChartPoint[]; drawn: number }
export type StatusTab = { kind: "status"; points: ChartPoint[] }
export type SeatsTab = { kind: "seats"; points: (ChartPoint & { seats: number; full: boolean; paid: number; partial: number; free: number })[] }
export type SourcesTab = { kind: "sources"; points: (ChartPoint & { percent: number })[]; total: number }
export type ChartTab = ClassesTab | MonthsTab | SeatsTab | SourcesTab | StatusTab

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]

/** Students per class: a column a class, named in full. */
export function classesTab(counts: HomeChartCounts): ClassesTab | null {
  if (counts.total === 0) return null
  return {
    kind: "classes",
    points: counts.classes.map(({ className, count }) => ({
      label: className,
      short: className,
      value: count,
      tip: { number: String(count), words: `${className} · students` },
    })),
  }
}

/**
 * Applications per month of the calendar year, January to December, for
 * the year shown (owner, 2026-11-27). A month counts that month's
 * applications in any calendar year, so a family that came late (September
 * 2026 for 2026) or early still shows, and the months add up to the total.
 * Once the year is over the line runs through all twelve months. While it
 * is still taking applicants it runs from January to this month, drawn
 * lighter, or on to a later month that already has applicants; the months
 * after are left empty.
 */
export function monthsTab(counts: HomeChartCounts, today: string, open: boolean): MonthsTab | null {
  if (counts.total === 0) return null
  const byMonth = Array<number>(12).fill(0)
  for (const row of counts.months) byMonth[Number(row.month.slice(5, 7)) - 1] += row.count
  const now = Number(today.slice(5, 7)) - 1
  const last = byMonth.findLastIndex((count) => count > 0)
  const drawn = open ? Math.max(now, last) + 1 : 12
  const points = MONTHS.map((name, i) => {
    const part = open && i === now
    return {
      label: name,
      short: name.slice(0, 3),
      value: byMonth[i],
      part,
      tip: { number: String(byMonth[i]), words: `${part ? `${name} so far` : name} · applications` },
    }
  })
  return { kind: "months", points, drawn }
}

/**
 * Where the year's applicants are now, a bar a status from Applied at the
 * top to Enrolled and Declined, imported records with the rest.
 */
export function statusTab(counts: HomeChartCounts): StatusTab | null {
  if (counts.total === 0) return null
  return {
    kind: "status",
    points: counts.statuses.map(({ status, count }) => ({
      label: status,
      short: status,
      value: count,
      tip: { number: String(count), words: `${status} · applicants` },
    })),
  }
}

/**
 * One class on the Seats tab: its seats, the children placed in it by how
 * much they paid (in full; part, a Deposit or First instalment), its free
 * seats, and whether it is full.
 */
export type SeatsTabClass = { className: LeadClass; seats: number; paid: number; partial: number; free: number; full: boolean }

/** The Seats tab from each class’s figures, in the order given. */
export function seatsTabOf(rows: readonly SeatsTabClass[]): SeatsTab | null {
  if (rows.length === 0) return null
  return {
    kind: "seats",
    points: rows.map(({ className, seats, paid, partial, free, full }) => ({
      label: className,
      short: className,
      value: paid + partial,
      seats,
      paid,
      partial,
      free,
      full,
      tip: { number: `${paid + partial} of ${seats}`, words: `${className} · ${paid} paid in full, ${partial} partial payment` },
    })),
  }
}

const SOURCE_NAMES: Record<ApplicationSource, { label: string; short: string }> = {
  admission_form: { label: "Admission form", short: "Admission form" },
  agent_code: { label: "Agents’ Discount codes", short: "Agents" },
  promo_code: { label: "Promo codes", short: "Promo codes" },
  walk_in: { label: "Walk-in at the desk", short: "Walk-in" },
}

/** Applications by where they came from: the ring with the total in the middle, and its list. */
export function sourcesTab(counts: HomeChartCounts): SourcesTab | null {
  if (counts.total === 0) return null
  const points = counts.sources.map(({ source, count }) => {
    const percent = Math.round((count / counts.total) * 100)
    return {
      label: SOURCE_NAMES[source].label,
      short: SOURCE_NAMES[source].short,
      value: count,
      percent,
      tip: { number: `${count} · ${percent}%`, words: SOURCE_NAMES[source].label },
    }
  })
  return { kind: "sources", points, total: counts.total }
}

/**
 * The Sources ring in the SVG's own units (a 140 box, centred at 70): its
 * middle radius, its width, the gap between slices along the middle, and the
 * small round corners every slice has instead of a round end.
 */
export const RING = { centre: 70, radius: 54, width: 15, gap: 4, corner: 3 } as const

const INNER = RING.radius - RING.width / 2 + RING.corner
const OUTER = RING.radius + RING.width / 2 - RING.corner

/** One source's share of the ring, in radians clockwise from the top, its gaps included. */
export type RingSlice = { index: number; start: number; end: number }

/**
 * The ring's slices, one per source with a number, each its true share of
 * the ring. A source too small to show past its gaps and corners is given
 * just enough to show as a thin sliver, taken from the others in
 * proportion. With one source, or none, the ring is whole: `full` names the
 * shade to draw it in.
 */
export function ringSlices(values: readonly number[]): { full: number | null; slices: RingSlice[] } {
  const live = values.flatMap((value, index) => (value > 0 ? [index] : []))
  if (live.length < 2) return { full: live[0] ?? 0, slices: [] }
  const around = 2 * Math.PI
  // The least a slice can take: its gap, its two corners on the inside edge, and a sliver.
  const least = RING.gap / RING.radius + (2 * RING.corner) / INNER + 2 / RING.radius
  const angles = new Map<number, number>()
  const small = new Set<number>()
  for (;;) {
    const rest = live.filter((index) => !small.has(index))
    const room = around - small.size * least
    const sum = rest.reduce((total, index) => total + values[index], 0)
    for (const index of rest) angles.set(index, (values[index] / sum) * room)
    const tooSmall = rest.filter((index) => angles.get(index)! < least)
    if (tooSmall.length === 0) break
    for (const index of tooSmall) {
      small.add(index)
      angles.set(index, least)
    }
  }
  let start = 0
  const slices = live.map((index) => {
    const slice = { index, start, end: start + angles.get(index)! }
    start = slice.end
    return slice
  })
  return { full: null, slices }
}

const at = (r: number, angle: number) =>
  `${(RING.centre + r * Math.sin(angle)).toFixed(2)},${(RING.centre - r * Math.cos(angle)).toFixed(2)}`

/**
 * A slice as a filled ring piece, its gap taken off both ends and pulled in
 * by its corner, to be drawn with a round-joined stroke of twice the corner:
 * the stroke grows it back to the full width with small round corners.
 */
export function slicePath({ start, end }: RingSlice): string {
  const a0 = start + RING.gap / 2 / RING.radius
  const a1 = end - RING.gap / 2 / RING.radius
  const o0 = a0 + RING.corner / OUTER
  const o1 = a1 - RING.corner / OUTER
  const i0 = a0 + RING.corner / INNER
  const i1 = a1 - RING.corner / INNER
  // Each edge spans its own angle, so each takes its own large-arc flag: a slice just over half the ring can have one edge past π and the other not.
  const outerLarge = o1 - o0 > Math.PI ? 1 : 0
  const innerLarge = i1 - i0 > Math.PI ? 1 : 0
  return `M${at(OUTER, o0)} A${OUTER},${OUTER} 0 ${outerLarge} 1 ${at(OUTER, o1)} L${at(INNER, i1)} A${INNER},${INNER} 0 ${innerLarge} 0 ${at(INNER, i0)} Z`
}

/**
 * Months' line through its points, January first, split for drawing: the
 * solid line, the piece into the month still running (dashed), and the
 * glow under the line. The running month's piece is dashed wherever it
 * falls, also when later months already have applicants; the glow stops
 * before it only when it ends the line. `part` is the running month's
 * index among the points, or -1.
 */
export function monthLine(points: readonly (readonly [number, number])[], part: number, height: number): { solid: string; dashed: string | null; area: string } | null {
  if (points.length < 2) return null
  const line = smoothLine(points)
  // smoothLine's pieces: piece k runs from point k to point k + 1.
  const pieces = line.split(" C").slice(1).map((piece) => `C${piece}`)
  const start = line.slice(0, line.indexOf(" C"))
  const ends = [start.slice(1), ...pieces.map((piece) => piece.slice(piece.lastIndexOf(" ") + 1))]
  const into = part > 0 ? part - 1 : -1
  let solid = ""
  pieces.forEach((piece, k) => {
    if (k === into) return
    solid += solid === "" || k === into + 1 ? `${solid === "" ? "" : " "}M${ends[k]} ${piece}` : ` ${piece}`
  })
  const last = into === pieces.length - 1
  const glow = last ? pieces.slice(0, -1) : pieces
  const area = glow.length > 0 ? `${start} ${glow.join(" ")} L${ends[glow.length].split(",")[0]},${height} L${ends[0].split(",")[0]},${height} Z` : ""
  return { solid, dashed: into >= 0 ? `M${ends[into]} ${pieces[into]}` : null, area }
}

/** A round top for the scale and the step between its lines, at most five steps. */
export function niceScale(max: number): { top: number; step: number } {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) {
    if (Math.ceil(max / step) <= 5) return { top: Math.max(step, Math.ceil(max / step) * step), step }
  }
  const step = Math.ceil(max / 5)
  return { top: step * 5, step }
}
