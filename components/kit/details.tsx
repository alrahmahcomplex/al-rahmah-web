import type { ReactNode } from "react"

import { Icon, type IconName } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

export type KeyValueItem = {
  key: ReactNode
  value: ReactNode
  /** A 12.5px Slate Quiet line under the value: why a fee is what it is. */
  reason?: ReactNode
  /** Tabular figures for an Admission Number, money or a date. */
  numeric?: boolean
}

/** Facts about one record (DESIGN.md, Lists): the key in Slate Quiet, the value in 600. */
export function KeyValueList({ items, className }: { items: KeyValueItem[]; className?: string }) {
  return (
    <dl className={cn("kit-kv", className)}>
      {items.map((item, i) => (
        <div key={i} className="contents">
          <dt>{item.key}</dt>
          <dd className={item.numeric ? "kit-num" : undefined}>
            {item.value}
            {item.reason && <small>{item.reason}</small>}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** A part of a card or sheet under a Section title ("Student", "Custodian"); a Lavender Mist line between sections. */
export function Section({ title, className, children }: { title: ReactNode; className?: string; children: ReactNode }) {
  return (
    <div className={cn("kit-sec", className)}>
      <h3 className="kit-sec-title">{title}</h3>
      {children}
    </div>
  )
}

export type NoteTone = "info" | "good" | "wait" | "bad"

const NOTE_ICON: Record<NoteTone, IconName> = { info: "info", good: "check", wait: "alert", bad: "alert" }

/**
 * A note (DESIGN.md, Notes): one thing and what to do about it, on a tint.
 * Give it a role when it reports something: `status` for news that can wait,
 * `alert` for a failure the person must see now.
 */
export function Note({
  tone = "info",
  icon,
  role,
  className,
  children,
}: {
  tone?: NoteTone
  icon?: IconName
  role?: "status" | "alert" | "note"
  className?: string
  children: ReactNode
}) {
  return (
    <div role={role} className={cn("kit-note", className)} data-tone={tone === "info" ? undefined : tone}>
      <Icon name={icon ?? NOTE_ICON[tone]} />
      <span>{children}</span>
    </div>
  )
}
