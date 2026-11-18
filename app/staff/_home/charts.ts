import type { ClassSeatFigures } from "@/lib/services/dashboard"
import type { ApplicationSource, HomeChartCounts } from "@/lib/services/home-charts"
import type { LeadClass } from "@/lib/services/leads"

// Home's chart card (#405), measured from prototype v38 → Home: what each tab
// draws and the sentence over it, worked out from the counts. A tab with
// nothing to draw is left out, so no tab ever needs words for "none yet".

/** One mark on a chart: a dot, a column, a capsule or a row of the ring's list. */
export type ChartPoint = {
  /** The name in full, for the table and the tooltip. */
  label: string
  /** The label under the mark. */
  short: string
  value: number
  /** Drawn lighter: the month still running. */
  part?: boolean
  /** The tooltip: the number in bold, what it is underneath. */
  tip: { number: string; words: string }
}

export type ClassesTab = { kind: "classes"; heading: string; points: ChartPoint[]; groups: AxisGroup[] }
export type MonthsTab = { kind: "months"; heading: string; points: ChartPoint[]; note: string | null }
export type SeatsTab = { kind: "seats"; heading: string; points: (ChartPoint & { seats: number; full: boolean; fill: number })[] }
export type SourcesTab = { kind: "sources"; heading: string; points: (ChartPoint & { percent: number })[]; total: number }
export type ChartTab = ClassesTab | MonthsTab | SeatsTab | SourcesTab

/** A run of classes of one school level under the axis. */
export type AxisGroup = { label: string; short: string; span: number }

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const applications = (n: number) => `${n} application${n === 1 ? "" : "s"}`

/** "A", "A and B". */
const both = (names: string[]) => names.join(" and ")

// The first of the largest, so a tie goes to the earlier one in the list's order.
function largest<T>(items: T[], value: (item: T) => number): T | undefined {
  let best: T | undefined
  for (const item of items) if (best === undefined || value(item) > value(best)) best = item
  return best
}

const classShort = (name: LeadClass) => (name === "DAY CARE" ? "DC" : name === "KG 1" ? "KG1" : name === "KG 2" ? "KG2" : name.replace(/^(STD|FORM) /, ""))
const classGroup = (name: LeadClass) => (name.startsWith("STD") ? "Primary · STD" : name.startsWith("FORM") ? "Secondary · FORM" : "Nursery")

/** Students per class: the smooth glow line, the axis grouped Nursery / STD / FORM. */
export function classesTab(counts: HomeChartCounts): ClassesTab | null {
  if (counts.total === 0) return null
  const top = counts.classes
    .filter((row) => row.count > 0)
    .toSorted((a, b) => b.count - a.count)
    .slice(0, 2)
    .map((row) => row.className)
  const groups: AxisGroup[] = []
  for (const { className } of counts.classes) {
    const label = classGroup(className)
    const last = groups.at(-1)
    if (last?.label === label) last.span++
    else groups.push({ label, short: label.split(" · ").pop()!, span: 1 })
  }
  return {
    kind: "classes",
    heading: `${both(top)} ${top.length === 1 ? "draws" : "draw"} the most students`,
    points: counts.classes.map(({ className, count }) => ({
      label: className,
      short: classShort(className),
      value: count,
      tip: { number: String(count), words: `${className} · students` },
    })),
    groups,
  }
}

/** Applications per month this year, January to the month running, which is drawn lighter. */
export function monthsTab(counts: HomeChartCounts, today: string): MonthsTab | null {
  if (counts.total === 0) return null
  const current = Number(today.slice(5, 7)) - 1
  const points = counts.months.slice(0, current + 1).map((value, i) => {
    const part = i === current
    return {
      label: MONTHS[i],
      short: MONTHS[i].slice(0, 3),
      value,
      part,
      tip: { number: String(value), words: `${part ? `${MONTHS[i]} so far` : MONTHS[i].slice(0, 3)} · applications` },
    }
  })
  const busiest = largest(points, (point) => point.value)!
  return {
    kind: "months",
    heading: busiest.part
      ? `${busiest.label} is the busiest month so far, with ${applications(busiest.value)}`
      : `${busiest.label} was the busiest month, with ${applications(busiest.value)}`,
    points,
    note: `${MONTHS[current]} so far, shown lighter.`,
  }
}

/**
 * Seats held against the seats in each class, Day and Boarding together, in
 * the year the Seats screen opens on. A section with no seats set and none
 * held (Boarding where the class has none) is skipped. A class is left out
 * when it has no seats set at all, or when seats are held in a section with
 * no seats set, since its free seats are then not known. Zero seats set is a
 * class with no seats: Full.
 */
export function seatsTab(classes: readonly ClassSeatFigures[]): SeatsTab | null {
  const byClass = new Map<LeadClass, { seats: number; held: number; unknown: boolean }>()
  for (const entry of classes) {
    if (entry.seats === null && entry.taken === 0) continue
    const sum = byClass.get(entry.className) ?? { seats: 0, held: 0, unknown: false }
    if (entry.seats === null) sum.unknown = true
    else sum.seats += entry.seats
    sum.held += entry.taken
    byClass.set(entry.className, sum)
  }
  const rows = [...byClass]
    .filter(([, { unknown }]) => !unknown)
    .map(([className, { seats, held }]) => ({ className, seats, held, full: held >= seats, free: seats - held }))
  return seatsTabOf(rows)
}

/** One class on the Seats tab: its seats and seats held, whether it is full, and its free seats. */
export type SeatsTabClass = { className: LeadClass; seats: number; held: number; full: boolean; free: number }

/** The Seats tab from each class’s figures, in class order. */
export function seatsTabOf(rows: readonly SeatsTabClass[]): SeatsTab | null {
  if (rows.length === 0) return null

  const points = rows.map(({ className, seats, held, full, free }) => {
    return {
      label: className,
      short: className === "DAY CARE" ? "DC" : className,
      value: held,
      seats,
      full,
      fill: seats === 0 ? 100 : Math.min(100, (held / seats) * 100),
      tip: { number: `${held} of ${seats}`, words: `${className} · ${full ? "Full" : `${free} free`}` },
    }
  })

  const full = points.filter((point) => point.full).map((point) => point.label)
  const freeOf = new Map(rows.map((row) => [row.className as string, row.free]))
  const roomy = largest(
    points.filter((point) => !point.full),
    (point) => freeOf.get(point.label) ?? point.seats - point.value,
  )
  const fullLine =
    full.length === 0
      ? null
      : full.length === points.length && full.length > 2
        ? "Every class is full"
        : full.length > 2
          ? `${full.length} classes are full`
          : `${both(full)} ${full.length === 1 ? "is" : "are"} full`
  const roomyLine = roomy ? `${roomy.label} has the most free seats, ${freeOf.get(roomy.label) ?? roomy.seats - roomy.value}` : null
  return { kind: "seats", heading: [fullLine, roomyLine].filter(Boolean).join(". "), points }
}

const SOURCE_NAMES: Record<ApplicationSource, { label: string; short: string; heading: string }> = {
  admission_form: { label: "Admission form", short: "Admission form", heading: "Most families apply through the Admission form" },
  agent_code: { label: "Agents’ Discount codes", short: "Agents", heading: "Most families apply with an agent’s Discount code" },
  promo_code: { label: "Promo codes", short: "Promo codes", heading: "Most families apply with a Promo code" },
  walk_in: { label: "Walk-in at the desk", short: "Walk-in", heading: "Most families apply at the desk" },
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
  const top = largest(counts.sources, (row) => row.count)!
  return { kind: "sources", heading: SOURCE_NAMES[top.source].heading, points, total: counts.total }
}

/** The Sources ring as prototype v40 draws it, in the SVG's own units. */
export const RING = { radius: 54, width: 15, gap: 4 } as const

export type RingArc = { index: number; dash: number; rest: number; offset: number }

/**
 * The ring's arcs, one per source with a number, each with soft round ends
 * and the same small gap to its neighbours. A round end reaches half the
 * stroke's width past its dash, so every dash is shortened by the gap and one
 * stroke width and starts half of that in. A source too small for its round
 * ends is given just enough of the ring to show as a dot with its gaps, taken
 * from the others in proportion, so no arc is drawn over its neighbour. With
 * one source, or none, the ring is whole: `full` names the shade to draw it
 * in.
 */
export function ringArcs(values: readonly number[]): { full: number | null; arcs: RingArc[] } {
  const around = 2 * Math.PI * RING.radius
  const live = values.flatMap((value, index) => (value > 0 ? [index] : []))
  if (live.length < 2) return { full: live[0] ?? 0, arcs: [] }
  const inset = RING.gap + RING.width
  // The least of the ring an arc can take: its two round ends and its gap.
  const least = inset + 0.01
  const lengths = new Map<number, number>()
  const small = new Set<number>()
  for (;;) {
    const rest = live.filter((index) => !small.has(index))
    const room = around - small.size * least
    const sum = rest.reduce((total, index) => total + values[index], 0)
    for (const index of rest) lengths.set(index, (values[index] / sum) * room)
    const tooSmall = rest.filter((index) => lengths.get(index)! < least)
    if (tooSmall.length === 0) break
    for (const index of tooSmall) {
      small.add(index)
      lengths.set(index, least)
    }
  }
  let start = 0
  const arcs = live.map((index) => {
    const length = lengths.get(index)!
    const dash = length - inset
    const arc = { index, dash, rest: around - dash, offset: start + inset / 2 }
    start += length
    return arc
  })
  return { full: null, arcs }
}

/** A round top for the scale and the step between its lines, at most five steps. */
export function niceScale(max: number): { top: number; step: number } {
  for (const step of [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) {
    if (Math.ceil(max / step) <= 5) return { top: Math.max(step, Math.ceil(max / step) * step), step }
  }
  const step = Math.ceil(max / 5)
  return { top: step * 5, step }
}
