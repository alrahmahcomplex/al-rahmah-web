import Link from "next/link"
import type { ReactNode } from "react"

import { Icon } from "@/components/icons"
import { cn } from "@/lib/utils"

import "./picked.css"

/**
 * The page numbers to show: every page up to 7, otherwise 7 places, the first
 * and last page always among them and "gap" for the pages left out.
 * pageWindow(3, 12) is [1, 2, 3, 4, 5, "gap", 12].
 */
export function pageWindow(page: number, count: number): (number | "gap")[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  if (page <= 4) return [1, 2, 3, 4, 5, "gap", count]
  if (page >= count - 3) return [1, "gap", count - 4, count - 3, count - 2, count - 1, count]
  return [1, "gap", page - 1, page, page + 1, "gap", count]
}

export type PaginationProps = {
  /** Names the nav, such as "Applicant pages". */
  label: string
  /** The page on screen, from 1. */
  page: number
  pageCount: number
  /** Each page is a link: pass the href of a page. A server page passes this. */
  href?: (page: number) => string
  /** Or each page is a button, inside a client part. */
  onPage?: (page: number) => void
  previousLabel: string
  nextLabel: string
  /** A page number's name for a screen reader, such as "Page 3"; the number alone otherwise. */
  pageLabel?: (page: number) => string
  className?: string
}

/**
 * Pagination A, numbered pills (prototype v38), for a list longer than 10
 * rows: Previous, the page numbers, Next. The current page is the indigo pill,
 * marked aria-current="page". Previous and Next are disabled at the ends.
 * Nothing shows for a single page.
 */
export function Pagination({ label, page, pageCount, href, onPage, previousLabel, nextLabel, pageLabel, className }: PaginationProps) {
  if (pageCount <= 1) return null
  const go = (to: number, content: ReactNode, name?: string, key?: string) => {
    const off = to < 1 || to > pageCount
    const current = to === page && !name
    if (off) {
      return (
        <button key={key} type="button" className="kit-pg" aria-label={name} disabled>
          {content}
        </button>
      )
    }
    const props = { className: "kit-pg", "aria-label": name ?? pageLabel?.(to), "aria-current": current ? ("page" as const) : undefined }
    if (href) {
      return (
        <Link key={key} href={href(to)} {...props}>
          {content}
        </Link>
      )
    }
    return (
      <button key={key} type="button" {...props} onClick={() => onPage?.(to)}>
        {content}
      </button>
    )
  }
  let gaps = 0
  return (
    <nav aria-label={label} className={cn("kit-pga", className)}>
      {go(page - 1, <Icon name="back" size={16} />, previousLabel, "previous")}
      {pageWindow(page, pageCount).map((slot) =>
        slot === "gap" ? (
          <span key={`gap-${gaps++}`} className="kit-pg-gap" aria-hidden="true">
            …
          </span>
        ) : (
          go(slot, slot, undefined, `p${slot}`)
        ),
      )}
      {go(page + 1, <Icon name="right" size={16} />, nextLabel, "next")}
    </nav>
  )
}
