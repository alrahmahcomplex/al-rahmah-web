"use client"

import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type FilterOption = { value: string; label: ReactNode }

export type FilterLink = {
  /** The pill's words. A count is part of them, as text: "Retired (3)". */
  label: ReactNode
  href: string
}

type Shared = {
  /** The row's name for a screen reader, such as "Filter by status". */
  label: string
  className?: string
  /** Follow the pills: a Line tag, a Clear link. */
  children?: ReactNode
}

type ButtonMode = Shared & {
  options: FilterOption[]
  value: string
  onChange: (value: string) => void
  current?: never
  scroll?: never
}

type LinkMode = Shared & {
  /** Each pill is a link to a page or a search param. */
  options: FilterLink[]
  /** The href of the filter on screen, or null when none is. */
  current: string | null
  /** Passed to each Link; false keeps the page where it is. */
  scroll?: boolean
  value?: never
  onChange?: never
}

// `current` is null, not left out, when no filter is on screen.
const isLinkMode = (props: ButtonMode | LinkMode): props is LinkMode => props.current !== undefined

/**
 * The row of 36px filter pills above a list (DESIGN.md, Lists). With `value`
 * and `onChange`, each pill is a toggle button with aria-pressed in a named
 * group. With `href` options and `current`, each pill is a link in a named
 * nav, so the filter works without JavaScript and Back returns to it; the
 * current one has aria-current="page". Either way the chosen pill turns
 * indigo with Exo italic. `children` follow the pills.
 */
export function FilterPills(props: ButtonMode | LinkMode) {
  const { label, className, children } = props

  if (isLinkMode(props)) {
    const { options, current, scroll } = props
    return (
      <nav aria-label={label} className={cn("kit-tools", className)}>
        {options.map((option) => (
          <Link key={option.href} href={option.href} scroll={scroll} className="kit-fpill" aria-current={option.href === current ? "page" : undefined}>
            {option.label}
          </Link>
        ))}
        {children}
      </nav>
    )
  }

  const { options, value, onChange } = props
  return (
    <div role="group" aria-label={label} className={cn("kit-tools", className)}>
      {options.map((option) => (
        <button key={option.value} type="button" className="kit-fpill" aria-pressed={value === option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
      {children}
    </div>
  )
}
