import type { Key, ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"
import "./timeline.css"

export type TimelineTone = "ok" | "wait"

export type TimelineItem = {
  key: Key
  /** What happened, in the 14.5px semibold line. */
  title: ReactNode
  /** Who and when, in the Slate Quiet line under it. */
  meta?: ReactNode
  /** The dot's ring: indigo by default, green for `ok`, orange for `wait`. */
  tone?: TimelineTone
  /** Anything more under the meta line, such as the fields an edit changed. */
  children?: ReactNode
}

/**
 * What happened, newest first (prototype v38, Design system → Timeline): a
 * ringed dot per entry on a Lavender Mist line. A student's history and the
 * audit log use it. `label` names the list for a screen reader.
 */
export function Timeline({ items, label, className }: { items: readonly TimelineItem[]; label: string; className?: string }) {
  return (
    <ol aria-label={label} className={cn("kit-tl", className)}>
      {items.map((item) => (
        <li key={item.key} data-tone={item.tone}>
          <i aria-hidden="true" />
          <div className="kit-tl-body">
            <p className="kit-tl-title">{item.title}</p>
            {item.meta && <p className="kit-tl-meta">{item.meta}</p>}
            {item.children}
          </div>
        </li>
      ))}
    </ol>
  )
}
