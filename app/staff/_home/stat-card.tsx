"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useId, useState } from "react"

import { MonthGrid, Popover, RoundButton, StatCard as KitStatCard } from "@/components/kit"

import { sparkShape, SPARK_HEIGHT, SPARK_WIDTH } from "./spark"
import { mondayOf, shortDay, type StatCard as StatCardData } from "./stats"

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
 * One of Home's two stat cards (#323), in the kit's stat card (#520): the
 * icon and title on top with the picker in the round button, the number and
 * its trend under them, and the 7-day line at the bottom. Once a past day or
 * week is shown, Reset sits beside the picker and brings back today or this
 * week by dropping `param` from the address.
 */
export function StatCard({
  card,
  param,
  today,
  picked,
  words,
}: {
  card: StatCardData
  /** `day` picks a past day in the calendar; `week` picks a past week in its week mode. */
  param: "day" | "week"
  /** Today in Tanzania, "YYYY-MM-DD". */
  today: string
  /** The past day, or the Monday of the past week, the card shows; null for today or this week. */
  picked: string | null
  words: { pick: string; choose: string; close: string; reset: string }
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [open, setOpen] = useState(false)

  function show(value: string | null) {
    const next = new URLSearchParams(params)
    if (value) next.set(param, value)
    else next.delete(param)
    const query = next.toString()
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
  }

  function pick(day: string) {
    setOpen(false)
    if (param === "day") show(day < today ? day : null)
    else show(mondayOf(day) < mondayOf(today) ? mondayOf(day) : null)
  }

  const spokenChange =
    card.change === 0
      ? `Same as ${card.comparedWith}`
      : `${Math.abs(card.change)} ${card.change > 0 ? "more" : "fewer"} than ${card.comparedWith}`

  return (
    <KitStatCard
      title={card.label}
      icon={param === "day" ? "interviews" : "applicants"}
      value={card.value}
      trend={{ change: card.change, label: spokenChange }}
      actions={
        <>
          {picked && <RoundButton icon="reset" label={words.reset} size={40} className="hm-stat-reset" onClick={() => show(null)} />}
          <Popover
            open={open}
            onOpenChange={setOpen}
            title={<span className="sr-only">{words.choose}</span>}
            closeLabel={words.close}
            trigger={<RoundButton icon={param === "day" ? "calendar" : "filter"} label={words.pick} size={40} on={!!picked} />}
          >
            <MonthGrid mode={param} value={picked ?? today} max={today} onPick={pick} autoFocus />
          </Popover>
        </>
      }
    >
      <Spark days={card.days} />
    </KitStatCard>
  )
}
