import Link from "next/link"
import type { ReactNode } from "react"

import { cn } from "@/lib/utils"

import "./kit.css"

export type TabLink = {
  /** The tab's words. A count is part of them, as text: "Active (12)". */
  label: ReactNode
  href: string
}

/**
 * Tabs (prototype version 18): links in the filter-pill look that wrap on a
 * phone. The current one is the indigo pill in white Exo 700 italic, marked
 * aria-current="page". Each tab is a page or a search param, so it works
 * without JavaScript.
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
  /** Follows the tabs inside the nav, such as a Clear search link. */
  children?: ReactNode
}) {
  return (
    <nav aria-label={label} className={cn("kit-tabs", className)}>
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} scroll={scroll} aria-current={tab.href === current ? "page" : undefined} className="kit-fpill kit-tab kit-num">
          {tab.label}
        </Link>
      ))}
      {children}
    </nav>
  )
}
