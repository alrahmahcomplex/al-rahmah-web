"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent } from "react"

import { Card, Select, TabSwitch } from "@/components/kit"

import { niceScale, RING, ringSlices, slicePath, type ChartPoint, type ChartTab, type ClassesTab, type MonthsTab, type SeatsTab, type SourcesTab, type StatusTab } from "./charts"
import { smoothLine } from "./spark"
import "./chart.css"

const TAB_NAMES: Record<ChartTab["kind"], string> = { classes: "Classes", months: "Months", seats: "Seats", sources: "Sources", status: "Status" }

type Tip = ChartPoint["tip"]
type ShownTip = Tip & { key: string; x: number; y: number }

/**
 * Home's chart card (#405), as the owner's chart-card prototype
 * (24tWDhYZ28Qs6CsJowG1h9) draws it: the sliding-track tabs across the top,
 * Sources first, one chart each in one indigo hue, and along the bottom the
 * Seats key (on Seats) and the admission-year list (#518), which picks the
 * year every tab but Seats counts; Seats is always the coming opening. The
 * card fills its place in Home's grid, so the chart takes the room left
 * over. A mark whose number the chart does not print shows it in a tooltip
 * on hover and on keyboard focus: the number in bold, what it is underneath.
 */
export function ChartCard({
  tabs,
  years,
  year,
  current,
  empty,
}: {
  tabs: ChartTab[]
  years: number[]
  year: number
  current: number
  /** The year picked has no applicant yet: said over the year list. */
  empty: boolean
}) {
  const [picked, setPicked] = useState<ChartTab["kind"] | undefined>(tabs[0]?.kind)
  // The tab shown, as the tabs show it: the first when the one picked has gone.
  const active = (tabs.find((tab) => tab.kind === picked) ?? tabs[0])?.kind
  return (
    <Card className="hm-chart" aria-label="Charts">
      {tabs.length > 0 && (
        <TabSwitch
          label="Charts"
          className="hm-ch-tabs"
          onChange={setPicked}
          tabs={tabs.map((tab) => ({ value: tab.kind, label: TAB_NAMES[tab.kind], panel: <ChartPanel key={tab.kind} tab={tab} /> }))}
        />
      )}
      {empty && <p className="hm-ch-none">No applicants for {year} yet.</p>}
      <div className="hm-ch-foot">
        {active === "seats" ? <SeatKey /> : <span />}
        {years.length > 0 && <YearPick years={years} year={year} current={current} />}
      </div>
    </Card>
  )
}

/**
 * The kit's choice list, its name "Admission year" kept for screen readers:
 * every year with an applicant, newest first. The current admission year is
 * the page without `?year`, so Home's plain link always opens on it.
 */
function YearPick({ years, year, current }: { years: number[]; year: number; current: number }) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const labelId = useId()

  function show(value: string) {
    const next = new URLSearchParams(params)
    if (Number(value) === current) next.delete("year")
    else next.set("year", value)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <div className="hm-ch-year">
      <span id={labelId} className="sr-only">
        Admission year
      </span>
      <Select
        aria-labelledby={labelId}
        className="hm-ch-yearpick"
        options={years.map((option) => ({ value: String(option), label: String(option) }))}
        value={String(year)}
        onValueChange={show}
      />
    </div>
  )
}

/** What the Seats capsules' shades mean. */
function SeatKey() {
  return (
    <ul className="hm-ch-key" aria-label="Seats key">
      <li>
        <i data-k="paid" aria-hidden="true" />
        Paid in full
      </li>
      <li>
        <i data-k="partial" aria-hidden="true" />
        Partial payment
      </li>
      <li>
        <i data-k="free" aria-hidden="true" />
        Free
      </li>
    </ul>
  )
}

function ChartPanel({ tab }: { tab: ChartTab }) {
  const { box, tipRef, shown, mark, hide, keep } = useChartTip()
  return (
    <div className="hm-ch" ref={box} onKeyDown={(event) => event.key === "Escape" && hide()}>
      {tab.kind === "classes" && <ClassColumns tab={tab} mark={mark} />}
      {tab.kind === "months" && <MonthsLine tab={tab} mark={mark} />}
      {tab.kind === "status" && <StatusBars tab={tab} />}
      {tab.kind === "seats" && <SeatCapsules tab={tab} mark={mark} />}
      {tab.kind === "sources" && <SourceRing tab={tab} mark={mark} />}
      {shown && (
        <span ref={tipRef} className="hm-ch-tip" aria-hidden="true" style={{ left: shown.x, top: shown.y }} onMouseEnter={keep} onMouseLeave={hide}>
          <b className="kit-num">{shown.number}</b>
          <small>{shown.words}</small>
        </span>
      )}
    </div>
  )
}

type Mark = (key: string, tip: Tip) => {
  tabIndex: 0
  "data-on"?: ""
  onMouseEnter: (event: MouseEvent<HTMLElement>) => void
  onMouseLeave: () => void
  onFocus: (event: FocusEvent<HTMLElement>) => void
  onBlur: () => void
}

// The tooltip sits over the mark's anchor (its dot, or the mark itself),
// kept inside the card. Leaving a mark hides it a moment later, so the
// pointer can move onto the tooltip and keep it (WCAG 1.4.13).
function useChartTip() {
  const box = useRef<HTMLDivElement>(null)
  const tipRef = useRef<HTMLSpanElement>(null)
  const leaving = useRef<number | undefined>(undefined)
  const [shown, setShown] = useState<ShownTip | null>(null)
  const keep = () => window.clearTimeout(leaving.current)

  const show = (key: string, tip: Tip, element: HTMLElement) => {
    keep()
    const frame = box.current?.getBoundingClientRect()
    if (!frame) return
    const anchor = element.querySelector<HTMLElement>("[data-anchor]") ?? element
    const rect = anchor.getBoundingClientRect()
    setShown({ ...tip, key, x: rect.left - frame.left + rect.width / 2, y: rect.top - frame.top })
  }
  const hide = () => {
    keep()
    setShown(null)
  }
  const hideSoon = () => {
    keep()
    leaving.current = window.setTimeout(() => setShown(null), 150)
  }
  useEffect(() => keep, [])

  useLayoutEffect(() => {
    const tip = tipRef.current
    const frame = box.current
    if (!shown || !tip || !frame) return
    const left = Math.min(frame.clientWidth - tip.offsetWidth, Math.max(0, shown.x - tip.offsetWidth / 2))
    tip.style.left = `${left}px`
    tip.style.top = `${shown.y - tip.offsetHeight - 10}px`
  }, [shown])

  const mark: Mark = (key, tip) => ({
    tabIndex: 0,
    "data-on": shown?.key === key ? "" : undefined,
    onMouseEnter: (event) => show(key, tip, event.currentTarget),
    onMouseLeave: hideSoon,
    onFocus: (event) => show(key, tip, event.currentTarget),
    onBlur: hide,
  })
  return { box, tipRef, shown, mark, hide, keep }
}

const spoken = (tip: Tip) => `${tip.number}, ${tip.words}`

/** The scale's lines, top to 0, with their numbers. */
function Grid({ top, step }: { top: number; step: number }) {
  const lines = Array.from({ length: top / step + 1 }, (_, i) => top - i * step)
  return (
    <div className="hm-ch-grid" aria-hidden="true">
      {lines.map((line) => (
        <span key={line}>
          <small className="kit-num">{line}</small>
        </span>
      ))}
    </div>
  )
}

/** The labels under the marks. On a narrow card they stand up, hanging from the axis. */
function Axis({ points, gap, className }: { points: ChartPoint[]; gap: number; className?: string }) {
  return (
    <div className={className} aria-hidden="true">
      <div className="hm-ch-x" style={{ "--n": points.length, "--gap": `${gap}px` } as CSSProperties}>
        {points.map((point) => (
          <span key={point.label}>{point.short}</span>
        ))}
      </div>
    </div>
  )
}

const W = 600
const H = 220

/** Classes: a thin column a class on a light grid, each named in full. */
function ClassColumns({ tab, mark }: { tab: ClassesTab; mark: Mark }) {
  const { top, step } = niceScale(Math.max(...tab.points.map((point) => point.value)))
  return (
    <>
      <div className="hm-ch-plot">
        <Grid top={top} step={step} />
        <div className="hm-ch-cols" style={{ "--n": tab.points.length } as CSSProperties}>
          {tab.points.map((point) => (
            <div key={point.label} className="hm-ch-col">
              <span
                role="img"
                aria-label={spoken(point.tip)}
                className="hm-ch-bar"
                style={{ height: `${Math.max(1, (point.value / top) * 100)}%` }}
                {...mark(point.label, point.tip)}
              />
            </div>
          ))}
        </div>
      </div>
      <Axis points={tab.points} gap={8} className="hm-ch-xw" />
    </>
  )
}

/**
 * Months: a smooth line with a soft glow under it, January to the last month
 * drawn, a dot a month. The month still running is a lighter dot, and when
 * it ends the line, the line runs into it dashed. The months after are left
 * empty.
 */
function MonthsLine({ tab, mark }: { tab: MonthsTab; mark: Mark }) {
  const glowId = `hm-glow${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const drawn = tab.points.slice(0, tab.drawn)
  const { top, step } = niceScale(Math.max(...drawn.map((point) => point.value)))
  const n = tab.points.length
  const xy = drawn.map((point, i) => [((i + 0.5) / n) * W, H - (point.value / top) * H] as const)
  const line = xy.length > 1 ? smoothLine(xy) : null
  // The last piece runs dashed into the month still running when that month ends the line.
  const dashed = line && drawn.at(-1)?.part ? line.lastIndexOf(" C") : -1
  const solid = line && dashed > 0 ? line.slice(0, dashed) : line
  const solidEnd = xy[dashed > 0 ? xy.length - 2 : xy.length - 1]
  const area = solid ? `${solid} L${solidEnd[0]},${H} L${xy[0][0]},${H} Z` : null
  return (
    <>
      <div className="hm-ch-plot">
        <Grid top={top} step={step} />
        <div className="hm-ch-area">
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true">
            <defs>
              <linearGradient id={glowId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="hm-ch-glow" />
                <stop offset="1" className="hm-ch-fade" />
              </linearGradient>
            </defs>
            {area && <path d={area} fill={`url(#${glowId})`} />}
            {solid && <path d={solid} className="hm-ch-stroke" vectorEffect="non-scaling-stroke" />}
            {line && dashed > 0 && (
              <path d={`M${solidEnd[0]},${solidEnd[1]} ${line.slice(dashed + 1)}`} className="hm-ch-stroke" data-part="" vectorEffect="non-scaling-stroke" />
            )}
          </svg>
          <div className="hm-ch-hits" style={{ "--n": n } as CSSProperties}>
            {tab.points.map((point, i) =>
              i < tab.drawn ? (
                <span key={point.label} role="img" aria-label={spoken(point.tip)} {...mark(point.label, point.tip)}>
                  <i data-anchor="" data-part={point.part ? "" : undefined} style={{ top: `${((xy[i][1] / H) * 100).toFixed(2)}%` }} />
                </span>
              ) : (
                <span key={point.label} aria-hidden="true" />
              ),
            )}
          </div>
        </div>
      </div>
      <Axis points={tab.points} gap={0} className="hm-ch-xw" />
    </>
  )
}

/** Status: a bar a status, Applied at the top, each fading in from the left with its number at its end; Declined lighter. */
function StatusBars({ tab }: { tab: StatusTab }) {
  const most = Math.max(1, ...tab.points.map((point) => point.value))
  return (
    <ul className="hm-ch-rows">
      {tab.points.map((point) => (
        <li key={point.label} data-off={point.label === "Declined" ? "" : undefined}>
          <span>{point.label}</span>
          <span className="hm-ch-run">
            <i aria-hidden="true" style={{ "--f": point.value === 0 ? 0 : Math.max(0.03, point.value / most) } as CSSProperties} />
            <b className="kit-num">{point.value}</b>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Seats: each capsule is the whole class; the seats held stack up from its
 * foot, paid in full first, then partial payment, flat on top; "N free" or
 * a red "Full" over it.
 */
function SeatCapsules({ tab, mark }: { tab: SeatsTab; mark: Mark }) {
  return (
    <>
      <div className="hm-ch-caps" style={{ "--n": tab.points.length } as CSSProperties}>
        {tab.points.map((point) => {
          const room = Math.max(point.seats, point.value)
          const held = room === 0 ? 0 : (point.value / room) * 100
          return (
            <div key={point.label} className="hm-ch-cap">
              <em className="kit-num" data-full={point.full ? "" : undefined}>
                {point.full ? "Full" : `${point.free} free`}
              </em>
              <span role="img" aria-label={spoken(point.tip)} className="hm-ch-track" {...mark(point.label, point.tip)}>
                {point.value > 0 && (
                  <span className="hm-ch-stack" style={{ height: `${Math.max(6, held)}%` }}>
                    {point.paid > 0 && <i data-k="paid" style={{ flexGrow: point.paid }} />}
                    {point.partial > 0 && <i data-k="partial" style={{ flexGrow: point.partial }} />}
                  </span>
                )}
              </span>
            </div>
          )
        })}
      </div>
      <Axis points={tab.points} gap={10} />
    </>
  )
}

/** Sources: a ring of slices with small round corners and the total in the middle, and the list beside it. */
function SourceRing({ tab, mark }: { tab: SourcesTab; mark: Mark }) {
  const { full, slices } = ringSlices(tab.points.map((point) => point.value))
  return (
    <div className="hm-ch-ring">
      <div className="hm-ch-rw">
        <svg viewBox="0 0 140 140" role="img" aria-label={tab.points.map((point) => `${point.label} ${point.value}`).join(", ")}>
          {full !== null && <circle cx={RING.centre} cy={RING.centre} r={RING.radius} className="hm-ch-arc" data-shade={full} />}
          {slices.map((slice) => (
            <path key={slice.index} d={slicePath(slice)} className="hm-ch-slice" data-shade={slice.index} strokeWidth={RING.corner * 2} />
          ))}
        </svg>
        <span className="hm-ch-total" aria-hidden="true">
          <b className="kit-num">{tab.total}</b>
          <small>{tab.total === 1 ? "application" : "applications"}</small>
        </span>
      </div>
      <ul className="hm-ch-legend">
        {tab.points.map((point, i) => (
          <li key={point.label} {...mark(point.label, point.tip)}>
            <i data-shade={i} aria-hidden="true" />
            <span>{point.label}</span>
            <b className="kit-num">{point.value}</b>
            <small className="kit-num">{point.percent}%</small>
          </li>
        ))}
      </ul>
    </div>
  )
}
