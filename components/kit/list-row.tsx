"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { Icon, type IconName } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./kit.css"

export type ListRowProps = {
  /** Shown in a 36px Lavender Whisper disc, featured (active). */
  icon?: IconName
  /** Something before the text instead of the disc, such as a Line tag with a time. */
  leading?: ReactNode
  title: ReactNode
  caption?: ReactNode
  /** A chip, a small button or a number at the end. A link row with nothing here gets the chevron. */
  trailing?: ReactNode
  /** The row opens this page. */
  href?: string
  /** The row is a button. Leave `href` and `onClick` out for a plain row. */
  onClick?: () => void
  /** Marks the row picked in a list beside a detail. */
  current?: boolean
  className?: string
}

/** A row in a card (DESIGN.md, Lists): disc, title over caption, something at the end; a Lavender Mist line between rows. */
export function ListRow({ icon, leading, title, caption, trailing, href, onClick, current, className }: ListRowProps) {
  const inside = (
    <>
      {leading}
      {icon && (
        <span className="kit-row-disc">
          <Icon name={icon} size={18} featured />
        </span>
      )}
      <span className="kit-row-text">
        <b className="kit-row-title">{title}</b>
        {caption && <small className="kit-row-cap">{caption}</small>}
      </span>
      {trailing ?? (href && <Icon name="right" size={16} className="kit-row-chev" />)}
    </>
  )
  const rowClass = cn("kit-row", className)
  if (href)
    return (
      <Link href={href} className={rowClass} aria-current={current ? "page" : undefined}>
        {inside}
      </Link>
    )
  if (onClick)
    return (
      <button type="button" className={rowClass} onClick={onClick} aria-current={current || undefined}>
        {inside}
      </button>
    )
  return <div className={rowClass}>{inside}</div>
}
