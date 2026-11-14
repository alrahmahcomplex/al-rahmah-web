"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useId, useState, type ReactNode } from "react"

import { RoundButton } from "@/components/kit"

import { sparkShape, SPARK_HEIGHT, SPARK_WIDTH } from "./spark"
import type { StatCard as StatCardData } from "./stats"
import { shortDay } from "./stats"

const TREND_PATHS = {
  up: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
  down: ["M3 7l6 6 4-4 8 8", "M15 17h6v-6"],
  flat: ["M4 12h16"],
}

/** The change beside the number: a green arrow up, a red arrow down, or a flat indigo line. */
function Trend({ change, comparedWith }: { change: number; comparedWith: string }) {
  const kind = change > 0 ? "up" : change < 0 ? "down" : "flat"
  const spoken = change === 0 ? `Same as ${comparedWith}` : `${Math.abs(change)} ${change > 0 ? "more" : "fewer"} than ${comparedWith}`
  return (
    <span className="hm-trend" data-kind={kind} role="img" aria-label={spoken}>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {TREND_PATHS[kind].map((d) => (
          <path key={d} d={d} />
        ))}
      </svg>
      <span aria-hidden="true">
        {change > 0 ? "+" : change < 0 ? "−" : ""}
        {Math.abs(change)}
      </span>
    </span>
  )
}

/** The 7 days ending on the day or week shown, with the number of a day on hover. */
function Spark({ days }: { days: StatCardData["days"] }) {
  // useId can hold characters a url(#…) reference does not take.
  const id = `spark${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  const [hovered, setHovered] = useState<number | null>(null)
  const shape = sparkShape(days.map((day) => day.value))
  const spoken = `Last 7 days. ${days.map((day) => `${shortDay(day.date)}: ${day.value}`).join(", ")}`
  const tip = hovered === null ? null : shape.dots[hovered]
  return (
    <div className="hm-spark" onMouseLeave={() => setHovered(null)}>
      <svg viewBox={`0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={spoken}>
        <defs>
          <linearGradient id={`${id}-fill`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" className="hm-spark-glow" />
            <stop offset="1" className="hm-spark-fade" />
          </linearGradient>
        </defs>
        <path d={shape.area} fill={`url(#${id}-fill)`} />
        <path d={shape.line} className="hm-spark-line" vectorEffect="non-scaling-stroke" />
      </svg>
      {shape.dots.map((dot, i) => (
        <i
          key={days[i].date}
          aria-hidden="true"
          data-last={i === shape.dots.length - 1 ? "" : undefined}
          style={{ left: `${dot.left}%`, top: `${dot.top}%` }}
          onMouseEnter={() => setHovered(i)}
        />
      ))}
      {tip && hovered !== null && (
        <span className="hm-tip" aria-hidden="true" style={{ left: `${tip.left}%`, top: `${tip.top}%` }}>
          {days[hovered].value}
        </span>
      )}
    </div>
  )
}

/**
 * One of Home's two stat cards (#323): the number with its trend, the
 * picker in the round button, the 7-day line and the label. Once a past day
 * or week is shown, Reset brings back today or this week by dropping
 * `param` from the address.
 */
export function StatCard({
  card,
  param,
  resetLabel,
  picker,
}: {
  card: StatCardData
  param: "day" | "week"
  resetLabel: string
  picker?: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const labelId = useId()
  const picked = params.has(param)

  function reset() {
    const next = new URLSearchParams(params)
    next.delete(param)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  return (
    <section className="hm-stat" aria-labelledby={labelId}>
      <div className="hm-stat-n">
        <b className="kit-num">{card.value}</b>
        <Trend change={card.change} comparedWith={card.comparedWith} />
      </div>
      {picker && <div className="hm-stat-pick">{picker}</div>}
      <div className="hm-stat-g">
        <Spark days={card.days} />
      </div>
      <p className="hm-stat-t" id={labelId}>
        {card.label}
      </p>
      {picked && <RoundButton icon="reset" label={resetLabel} size={40} className="hm-stat-reset" onClick={reset} />}
    </section>
  )
}
