"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type MouseEvent, type ReactNode } from "react"

import { Card, Select, Table, TabSwitch, TextLink } from "@/components/kit"

import { niceScale, RING, ringArcs, type AxisGroup, type ChartPoint, type ChartTab, type ClassesTab, type MonthsTab, type SeatsTab, type SourcesTab, type StatusTab } from "./charts"
import { smoothLine } from "./spark"
import "./chart.css"

const TAB_NAMES: Record<ChartTab["kind"], string> = { classes: "Classes", months: "Months", seats: "Seats", sources: "Sources", status: "Status" }

type Tip = ChartPoint["tip"]
type ShownTip = Tip & { key: string; x: number; y: number }

/**
 * Home's chart card (#405), as prototype v40 draws it: the sliding-track
 * tabs, Sources first, and under each the sentence the numbers say, "See the
 * numbers", and one chart in one indigo hue. The card fills its place in
 * Home's grid, so the chart takes the room left over. Every mark shows its tooltip on hover and on
 * keyboard focus: the number in bold, what it is underneath.
 * The admission-year list over the tabs (#518) picks the year every tab but
 * Seats counts; Seats is always the coming opening.
 */
export function ChartCard({ tabs, years, year, current }: { tabs: ChartTab[]; years: number[]; year: number; current: number }) {
  return (
    <Card className="hm-chart" aria-label="Charts">
      {years.length > 0 && <YearPick years={years} year={year} current={current} />}
      {tabs.length > 0 ? (
        <TabSwitch
          label="Charts"
          className="hm-ch-tabs"
          tabs={tabs.map((tab) => ({ value: tab.kind, label: TAB_NAMES[tab.kind], panel: <ChartPanel key={tab.kind} tab={tab} /> }))}
        />
      ) : (
        <p className="hm-ch-none">No applicants for {year} yet.</p>
      )}
    </Card>
  )
}

/**
 * "Admission year" and the kit's choice list: every year with an applicant,
 * newest first. The current admission year is the page without `?year`, so
 * Home's plain link always opens on it.
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
      <span id={labelId}>Admission year</span>
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

function ChartPanel({ tab }: { tab: ChartTab }) {
  const [open, setOpen] = useState(false)
  const tableId = useId()
  const { box, tipRef, shown, mark, hide, keep } = useChartTip()
  return (
    <div className="hm-ch" ref={box} onKeyDown={(event) => event.key === "Escape" && hide()}>
      <div className="hm-ch-h">
        <p className="hm-ch-head">{tab.heading}</p>
        <TextLink aria-expanded={open} aria-controls={tableId} onClick={() => setOpen(!open)}>
          {open ? "Hide the numbers" : "See the numbers"}
        </TextLink>
      </div>
      {tab.kind === "classes" && <ClassesLine tab={tab} mark={mark} />}
      {(tab.kind === "months" || tab.kind === "status") && <Columns tab={tab} mark={mark} />}
      {tab.kind === "seats" && <SeatCapsules tab={tab} mark={mark} />}
      {tab.kind === "sources" && <SourceRing tab={tab} mark={mark} />}
      <div id={tableId} hidden={!open}>
        {open && <NumbersTable tab={tab} />}
      </div>
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

/** The labels under the marks, and for classes their school level under those. */
function Axis({ points, groups, gap, className }: { points: ChartPoint[]; groups?: AxisGroup[]; gap: number; className?: string }) {
  const style = { "--n": points.length, "--gap": `${gap}px` } as CSSProperties
  return (
    <div className={className} aria-hidden="true">
      <div className="hm-ch-x" style={style}>
        {points.map((point) => (
          <span key={point.label}>{point.short}</span>
        ))}
      </div>
      {groups && (
        <div className="hm-ch-x hm-ch-xg" style={style}>
          {groups.map((group) => (
            <span key={group.label} style={{ gridColumn: `span ${group.span}` }}>
              <b className="hm-ch-lg">{group.label}</b>
              <b className="hm-ch-sm">{group.short}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

const W = 600
const H = 220

/** Classes: a smooth line with a soft glow under it, a dot a class, a guide line on hover. */
function ClassesLine({ tab, mark }: { tab: ClassesTab; mark: Mark }) {
  const glowId = `hm-glow${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const { top, step } = niceScale(Math.max(...tab.points.map((point) => point.value)))
  const n = tab.points.length
  const points = tab.points.map((point, i) => [((i + 0.5) / n) * W, H - (point.value / top) * H] as const)
  const line = smoothLine(points)
  const area = `M${points[0][0]},${H} L${points[0][0]},${points[0][1]} ${line.slice(line.indexOf(" ") + 1)} L${points[n - 1][0]},${H} Z`
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
            <path d={area} fill={`url(#${glowId})`} />
            <path d={line} className="hm-ch-stroke" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="hm-ch-hits" style={{ "--n": n } as CSSProperties}>
            {tab.points.map((point, i) => (
              <span key={point.label} role="img" aria-label={spoken(point.tip)} {...mark(point.label, point.tip)}>
                <i data-anchor="" style={{ top: `${((points[i][1] / H) * 100).toFixed(2)}%` }} />
              </span>
            ))}
          </div>
        </div>
      </div>
      <Axis points={tab.points} groups={tab.groups} gap={0} className="hm-ch-xw" />
    </>
  )
}

/** Months and Status: thin columns on a light grid, the month still running lighter. */
function Columns({ tab, mark }: { tab: MonthsTab | StatusTab; mark: Mark }) {
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
                data-part={point.part ? "" : undefined}
                style={{ height: `${Math.max(1, (point.value / top) * 100)}%` }}
                {...mark(point.label, point.tip)}
              />
            </div>
          ))}
        </div>
      </div>
      <Axis points={tab.points} gap={8} className="hm-ch-xw" />
      {tab.note && <p className="hm-ch-note">{tab.note}</p>}
    </>
  )
}

/** Seats: each capsule is the whole class, the fill the seats held, "N free" or a red "Full" on top. */
function SeatCapsules({ tab, mark }: { tab: SeatsTab; mark: Mark }) {
  return (
    <>
      <div className="hm-ch-caps" style={{ "--n": tab.points.length } as CSSProperties}>
        {tab.points.map((point) => (
          <div key={point.label} className="hm-ch-cap">
            <em className="kit-num" data-full={point.full ? "" : undefined}>
              {point.full ? "Full" : `${point.seats - point.value} free`}
            </em>
            <span role="img" aria-label={spoken(point.tip)} className="hm-ch-track" {...mark(point.label, point.tip)}>
              <i style={{ height: `${Math.max(6, point.fill)}%` }} />
            </span>
          </div>
        ))}
      </div>
      <Axis points={tab.points} gap={10} />
      <p className="hm-ch-note">Each capsule is the whole class. The fill is the seats held.</p>
    </>
  )
}

/** Sources: a ring with soft round ends and the total in the middle, and the list beside it. */
function SourceRing({ tab, mark }: { tab: SourcesTab; mark: Mark }) {
  const { full, arcs } = ringArcs(tab.points.map((point) => point.value))
  return (
    <div className="hm-ch-ring">
      <div className="hm-ch-rw">
        <svg viewBox="0 0 140 140" role="img" aria-label={tab.points.map((point) => `${point.label} ${point.value}`).join(", ")}>
          {full !== null && <circle cx="70" cy="70" r={RING.radius} className="hm-ch-arc" data-shade={full} />}
          {arcs.map((arc) => (
            <circle
              key={arc.index}
              cx="70"
              cy="70"
              r={RING.radius}
              className="hm-ch-arc"
              data-shade={arc.index}
              strokeLinecap="round"
              strokeDasharray={`${arc.dash.toFixed(2)} ${arc.rest.toFixed(2)}`}
              strokeDashoffset={(-arc.offset).toFixed(2)}
              transform="rotate(-90 70 70)"
            />
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

type TableRow = { label: string; value: ReactNode }

/** "See the numbers": the chart's numbers as a table. */
function NumbersTable({ tab }: { tab: ChartTab }) {
  const rows: TableRow[] =
    tab.kind === "seats"
      ? tab.points.map((point) => ({ label: point.label, value: `${point.value} of ${point.seats}` }))
      : tab.points.map((point) => ({ label: point.label, value: point.value }))
  const first = tab.kind === "seats" ? "Class" : tab.kind === "months" ? "Month" : tab.kind === "status" ? "Status" : "Group"
  return (
    <Table<TableRow>
      label={`${TAB_NAMES[tab.kind]}: the numbers`}
      className="hm-ch-tbl"
      rowKey={(row) => row.label}
      rows={rows}
      columns={[
        { header: first, cell: (row) => row.label, rowHeader: true },
        { header: tab.kind === "seats" ? "Seats held" : "Number", cell: (row) => row.value, align: "end" },
      ]}
    />
  )
}
