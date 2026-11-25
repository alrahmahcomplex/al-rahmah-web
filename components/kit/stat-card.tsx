"use client"

import { useId, type ReactNode } from "react"

import { Icon, type IconName } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

const TREND_PATHS = {
  up: ["M3 17l6-6 4 4 8-8", "M15 7h6v6"],
  down: ["M3 7l6 6 4-4 8 8", "M15 17h6v-6"],
  flat: ["M4 12h16"],
}

export type StatTrend = {
  /** This number minus the one it is compared with. */
  change: number
  /** What a screen reader says for the trend, such as "3 more than last week". */
  label: string
}

/** The change beside the number: a green arrow up, a red arrow down, or a flat indigo line. */
function Trend({ change, label }: StatTrend) {
  const kind = change > 0 ? "up" : change < 0 ? "down" : "flat"
  return (
    <span className="kit-trend" data-kind={kind} role="img" aria-label={label}>
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

export type StatCardProps = {
  /** Names the card, which is a region. */
  title: ReactNode
  /** The 18px icon before the title. */
  icon: IconName
  value: ReactNode
  trend?: StatTrend
  /** Round buttons on the right of the title row, such as a picker. */
  actions?: ReactNode
  /** What sits at the bottom of the card, such as a 7-day line. */
  children?: ReactNode
  className?: string
}

/**
 * A number card (#520, DESIGN.md, Cards): a small icon before the title, the
 * number under them on the left with its trend, then `children`. At rest the
 * icon is indigo with nothing behind it. Hovering the card, or focusing a
 * button in it, turns the icon's detail orange and grows a round Lavender
 * Whisper highlight behind it.
 */
export function StatCard({ title, icon, value, trend, actions, children, className }: StatCardProps) {
  const titleId = useId()
  return (
    <section className={cn("kit-stat", className)} aria-labelledby={titleId}>
      <p className="kit-stat-t" id={titleId}>
        <span className="kit-stat-ic">
          <Icon name={icon} size={18} />
        </span>
        <span className="kit-stat-tt">{title}</span>
      </p>
      {actions && <div className="kit-stat-act">{actions}</div>}
      <div className="kit-stat-n">
        <b className="kit-num">{value}</b>
        {trend && <Trend {...trend} />}
      </div>
      {children && <div className="kit-stat-g">{children}</div>}
    </section>
  )
}
