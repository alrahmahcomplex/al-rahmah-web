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
export type StatusTab = { kind: "status"; heading: string; points: ChartPoint[]; note: null }
export type SeatsTab = { kind: "seats"; heading: string; points: (ChartPoint & { seats: number; full: boolean; fill: number })[] }
export type SourcesTab = { kind: "sources"; heading: string; points: (ChartPoint & { percent: number })[]; total: number }
export type ChartTab = ClassesTab | MonthsTab | SeatsTab | SourcesTab | StatusTab

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

/**
 * Applications per month for the year shown, from the first month anyone in
 * it applied or visited to the last (owner, 2026-11-26): an imported record
 * counts in its own Visit date's month like any other. While the year is
 * still taking applicants, the columns run on to this month, drawn lighter.
 * Every applicant is in a column, so the columns add up to the total.
 */
export function monthsTab(counts: HomeChartCounts, today: string, open: boolean): MonthsTab | null {
  if (counts.total === 0) return null
  const now = today.slice(0, 7)
  const first = counts.months[0].month
  const latest = counts.months.at(-1)!.month
  const last = open && now > latest ? now : latest
  const byMonth = new Map(counts.months.map((row) => [row.month, row.count]))
  const points: ChartPoint[] = []
  for (let month = first; month <= last; month = nextMonth(month)) {
    const name = MONTHS[Number(month.slice(5, 7)) - 1]
    const label = `${name} ${month.slice(0, 4)}`
    const value = byMonth.get(month) ?? 0
    const part = open && month === now
    points.push({
      label,
      short: name.slice(0, 3),
      value,
      part,
      tip: { number: String(value), words: `${part ? `${label} so far` : label} · applications` },
    })
  }
  const busiest = largest(points, (point) => point.value)!
  return {
    kind: "months",
    heading: busiest.part
      ? `${busiest.label} is the busiest month so far, with ${applications(busiest.value)}`
      : `${busiest.label} was the busiest month, with ${applications(busiest.value)}`,
    points,
    note: points.some((point) => point.part) ? `${MONTHS[Number(now.slice(5, 7)) - 1]} so far, shown lighter.` : null,
  }
}

/**
 * Where the year's applicants are now, by status in the order a family moves
 * through them, imported records with the rest. While the year is open the
 * heading says just that; once it is over, how many enrolled.
 */
export function statusTab(counts: HomeChartCounts, open: boolean): StatusTab | null {
  if (counts.total === 0) return null
  const enrolled = counts.statuses.find((row) => row.status === "Enrolled")?.count ?? 0
  return {
    kind: "status",
    heading: open ? "Where the year’s applicants are now" : `${enrolled} of ${counts.total} applicants enrolled`,
    points: counts.statuses.map(({ status, count }) => ({
      label: status,
      short: status,
      value: count,
      tip: { number: String(count), words: `${status} · applicants` },
    })),
    note: null,
  }
}

// The month after a YYYY-MM month.
function nextMonth(month: string): string {
  const [y, m] = month.split("-").map(Number)
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`
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
  const rows = counts.sources
  const points = rows.map(({ source, count }) => {
    const percent = Math.round((count / counts.total) * 100)
    return {
      label: SOURCE_NAMES[source].label,
      short: SOURCE_NAMES[source].short,
      value: count,
      percent,
      tip: { number: `${count} · ${percent}%`, words: SOURCE_NAMES[source].label },
    }
  })
  const top = largest(rows, (row) => row.count)!
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
