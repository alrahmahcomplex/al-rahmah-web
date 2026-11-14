"use client"

import Link from "next/link"
import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"
import "./picked.css"

export type TabLink = {
  /** The tab's words. A count is part of them, as text: "Active (12)". */
  label: ReactNode
  href: string
}

const MOVES: Record<string, (i: number, n: number) => number> = {
  ArrowRight: (i, n) => (i + 1) % n,
  ArrowLeft: (i, n) => (i - 1 + n) % n,
  Home: () => 0,
  End: (_, n) => n - 1,
}

const trackStyle = (n: number, i: number) => ({ "--n": n, "--i": Math.max(i, 0) }) as CSSProperties

/**
 * Tabs C, the sliding track (prototype v38): equal tabs on a Lavender Whisper
 * track, the current one white on an indigo pill that slides to it. Each tab
 * is a link to a page or a search param, so it works without JavaScript; the
 * current one is marked aria-current="page". The pill moves on the click,
 * before the page arrives. Left and Right arrows, Home and End move between
 * the tabs.
 */
export function Tabs({
  label,
  tabs,
  current,
  scroll,
  className,
  children,
}: {
  /** Names the nav for a screen reader, such as "Application sections". */
  label: string
  tabs: TabLink[]
  /** The href of the tab on screen, or null when none is. */
  current: string | null
  /** Passed to each Link; false keeps the page where it is when a tab only changes a section. */
  scroll?: boolean
  className?: string
  /** Follows the track inside the nav, such as a Clear search link. */
  children?: ReactNode
}) {
  // The pill goes to the clicked tab at once. Any new `current` (the page arriving, or the
  // browser's Back) wins over the click.
  const [clicked, setClicked] = useState<string | null>(null)
  const [seen, setSeen] = useState(current)
  if (current !== seen) {
    setSeen(current)
    setClicked(null)
  }
  const at = tabs.findIndex((tab) => tab.href === (clicked ?? current))
  const links = useRef<(HTMLAnchorElement | null)[]>([])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key]
    const from = links.current.findIndex((link) => link === document.activeElement)
    if (!move || from < 0) return
    event.preventDefault()
    links.current[move(from, tabs.length)]?.focus()
  }

  return (
    <nav aria-label={label} className={cn("kit-tabs", className)}>
      <div className="kit-track" style={trackStyle(tabs.length, at)} onKeyDown={onKeyDown}>
        {at >= 0 && <span className="kit-track-pill" aria-hidden="true" />}
        {tabs.map((tab, i) => (
          <Link
            key={tab.href}
            ref={(el) => {
              links.current[i] = el
            }}
            href={tab.href}
            scroll={scroll}
            aria-current={tab.href === current ? "page" : undefined}
            data-on={i === at ? "" : undefined}
            className="kit-track-tab kit-num"
            onClick={(event) => {
              // A link opened in a new tab leaves this page where it is.
              if (!event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey && event.button === 0) setClicked(tab.href)
            }}
          >
            <span>{tab.label}</span>
          </Link>
        ))}
      </div>
      {children}
    </nav>
  )
}

export type TabPane<V extends string = string> = {
  value: V
  label: ReactNode
  /** What shows under the track while this tab is chosen. */
  panel: ReactNode
}

/**
 * The sliding track for sections inside one screen, such as Home's charts: a
 * tablist whose chosen tab shows its panel below. Left and Right arrows, Home
 * and End choose a tab and move to it; Tab then goes into the panel.
 */
export function TabSwitch<V extends string>({
  label,
  tabs,
  value: valueProp,
  defaultValue,
  onChange,
  className,
}: {
  /** Names the tablist, such as "Charts". */
  label: string
  tabs: TabPane<V>[]
  value?: V
  defaultValue?: V
  onChange?: (value: V) => void
  className?: string
}) {
  const [own, setOwn] = useState<V | undefined>(defaultValue ?? tabs[0]?.value)
  const value = valueProp ?? own
  const at = Math.max(
    tabs.findIndex((tab) => tab.value === value),
    0,
  )
  const base = useId()
  const buttons = useRef<(HTMLButtonElement | null)[]>([])

  const choose = (i: number) => {
    const next = tabs[i].value
    if (valueProp === undefined) setOwn(next)
    if (next !== value) onChange?.(next)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const move = MOVES[event.key]
    if (!move) return
    event.preventDefault()
    const i = move(at, tabs.length)
    choose(i)
    buttons.current[i]?.focus()
  }

  const shown = tabs[at]
  return (
    <div className={className}>
      <div role="tablist" aria-label={label} className="kit-track" style={trackStyle(tabs.length, at)} onKeyDown={onKeyDown}>
        <span className="kit-track-pill" aria-hidden="true" />
        {tabs.map((tab, i) => (
          <button
            key={tab.value}
            ref={(el) => {
              buttons.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-controls={`${base}-panel`}
            aria-selected={i === at}
            data-on={i === at ? "" : undefined}
            tabIndex={i === at ? 0 : -1}
            className="kit-track-tab kit-num"
            onClick={() => choose(i)}
          >
            <span>{tab.label}</span>
          </button>
        ))}
      </div>
      {shown && (
        <div role="tabpanel" id={`${base}-panel`} aria-labelledby={`${base}-tab-${at}`} tabIndex={0} className="kit-tabpanel">
          {shown.panel}
        </div>
      )}
    </div>
  )
}
