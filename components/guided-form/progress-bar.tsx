"use client"

import { useEffect, useRef, useState, type CSSProperties } from "react"

import { Icon as KitIcon } from "@/components/icons"
import { cn } from "@/lib/utils"

import { Icon } from "./icons"
import { buzz, prefersReducedMotion } from "./motion"
import "./guided-form.css"

export type ProgressGroup = {
  /** Shown in the section chip on the right while this group is active. */
  label: string
  /** Number of chips in the group. */
  steps: number
  /** Steps answered so far; chips 1..done fill in indigo. */
  done: number
  /** Index of the open step inside this group, drawn as a faint chip. Defaults to `done` for the active group. */
  current?: number
}

export type ProgressBarLabels = {
  /** aria-label of the Back button, e.g. "Rudi". */
  back: string
  /** aria-label of the Start over button, e.g. "Anza upya". */
  reset: string
}

export type ProgressBarProps = {
  groups: ProgressGroup[]
  /** The group the open question belongs to. Past the last group, the chip shows the last group's label. */
  activeGroup: number
  /** Small label above the first group, e.g. "Mwanafunzi wa pili". Shown while group 0 is active. */
  whoLabel?: string
  canBack: boolean
  onBack: () => void
  /** Start over replaces Back on the first question. */
  canReset?: boolean
  onReset?: () => void
  labels: ProgressBarLabels
  /** The screen-reader progress line, e.g. "Msimamizi: hatua 2 kati ya 3". Read politely when it changes. */
  status: string
  /**
   * Staff pages: draw Back and Start over with the set 2 icons and mark the
   * buttons as icon hosts, so they take the active look on hover inside the
   * new shell (components/icons/icons.css). The public forms leave it off.
   */
  kitIcons?: boolean
  className?: string
}

const BUBBLE_COLOURS = ["#ee7300", "#0900bb", "#ffb36b", "#6f66ff", "#0f7a3d", "#ee7300"]

type Bubble = { id: number; style: CSSProperties }

function makeBubbles(): Bubble[] {
  return Array.from({ length: 9 }, (_, i) => {
    const a = (Math.PI * 2 * i) / 9 + Math.random() * 0.5
    const r = 13 + Math.random() * 9
    return {
      id: i,
      style: {
        "--dx": `${(Math.cos(a) * r).toFixed(1)}px`,
        "--dy": `${(Math.sin(a) * r).toFixed(1)}px`,
        "--s": `${(2.5 + Math.random() * 2.5).toFixed(1)}px`,
        "--c": BUBBLE_COLOURS[i % BUBBLE_COLOURS.length],
        animationDelay: `${Math.round(Math.random() * 60)}ms`,
      } as CSSProperties,
    }
  })
}

/** One group: its number, its chips, the liquid merge and the green tick. Cheers once each time it fills. */
function Group({ group, index, active, who }: { group: ProgressGroup; index: number; active: boolean; who?: string }) {
  const full = group.steps > 0 && group.done >= group.steps
  // A group already full on first paint (a restored draft) shows its orange number without the cheer.
  const [won, setWon] = useState(full)
  const [cheer, setCheer] = useState(0)
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const wasFull = useRef(full)
  const [seenFull, setSeenFull] = useState(full)
  // A group that empties again (a step reopened with a problem) loses its orange number at once.
  if (seenFull !== full) {
    setSeenFull(full)
    if (!full) setWon(false)
  }

  useEffect(() => {
    const was = wasFull.current
    wasFull.current = full
    if (!full || was) return
    const calm = prefersReducedMotion()
    // The number waits for the liquid to run through the bar, then pops.
    const timer = window.setTimeout(() => {
      setWon(true)
      if (calm) return
      setCheer((n) => n + 1)
      setBubbles(makeBubbles())
      buzz()
    }, calm ? 0 : 820)
    return () => window.clearTimeout(timer)
  }, [full])

  useEffect(() => {
    if (bubbles.length === 0) return
    const timer = window.setTimeout(() => setBubbles([]), 900)
    return () => window.clearTimeout(timer)
  }, [bubbles])

  const current = group.current ?? (active ? group.done : -1)

  return (
    <div className={cn("gf-pg", full && "gf-full")} data-group={index}>
      {index === 0 && <span className={cn("gf-who", who && active && "gf-on")}>{who}</span>}
      <span key={cheer} className={cn("gf-gn", won && "gf-won", cheer > 0 && "gf-cheer")} data-won={won || undefined}>
        {index + 1}
        {bubbles.map((b) => (
          <span key={b.id} className="gf-bub" style={b.style} />
        ))}
      </span>
      <div className="gf-track">
        {Array.from({ length: group.steps }, (_, j) => {
          const filled = j < group.done
          return (
            <span key={j} className={cn("gf-chip", filled && "gf-fill", !filled && j === current && "gf-now")} data-chip={filled ? "done" : j === current ? "now" : "todo"}>
              <i />
            </span>
          )
        })}
        <span className="gf-liquid" />
        <span className="gf-ok">
          <Icon name="check" />
        </span>
      </div>
    </div>
  )
}

/**
 * The sticky row above the guided form: Back (or Start over on the first
 * question), the grouped step chips, and the outlined section chip.
 * Maps to `.bar-row`, `.navslot`, `.prog`, `.pg`, `.gn`, `.secname` in c2.html.
 */
export function ProgressBar({ groups, activeGroup, whoLabel, canBack, onBack, canReset = false, onReset, labels, status, kitIcons = false, className }: ProgressBarProps) {
  const [spin, setSpin] = useState(0)
  const host = kitIcons ? "" : undefined
  const glyph = (name: "back" | "reset") => (kitIcons ? <KitIcon name={name} /> : <Icon name={name} />)
  const showReset = canReset && !canBack
  const section = groups[Math.min(Math.max(activeGroup, 0), groups.length - 1)]?.label

  useEffect(() => {
    if (spin === 0) return
    const timer = window.setTimeout(() => setSpin(0), 560)
    return () => window.clearTimeout(timer)
  }, [spin])

  return (
    <div className={cn("gf-bar-row", className)}>
      <div className="gf-navslot">
        <button
          type="button"
          className={cn("gf-round", !canBack && "gf-off")}
          aria-label={labels.back}
          title={labels.back}
          tabIndex={canBack ? 0 : -1}
          aria-hidden={canBack ? undefined : true}
          data-icon-host={host}
          onClick={() => canBack && onBack()}
        >
          {glyph("back")}
        </button>
        <button
          type="button"
          className={cn("gf-round gf-reset", !showReset && "gf-off", spin > 0 && "gf-spin")}
          aria-label={labels.reset}
          title={labels.reset}
          tabIndex={showReset ? 0 : -1}
          aria-hidden={showReset ? undefined : true}
          data-icon-host={host}
          onClick={() => {
            if (!showReset) return
            setSpin((n) => n + 1)
            onReset?.()
          }}
        >
          {glyph("reset")}
        </button>
      </div>
      <div className="gf-prog" aria-hidden="true">
        {groups.map((group, i) => (
          <Group key={i} group={group} index={i} active={i === activeGroup} who={i === 0 ? whoLabel : undefined} />
        ))}
      </div>
      {section && (
        <span className="gf-secname" aria-hidden="true">
          {section}
        </span>
      )}
      <span className="sr-only" aria-live="polite">
        {status}
      </span>
    </div>
  )
}
