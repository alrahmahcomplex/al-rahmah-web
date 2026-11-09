import type { ReactNode } from "react"

import { LogoLoader } from "@/components/brand/logo-loader"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"

// Building blocks for the staff loading.tsx files. Each route composes them in
// the shape of its own page (heading, toolbar, table or cards), so the page
// lands where its outline already stood. The blocks stay still; the emblem
// beside the heading is the only thing that moves.

// Cell and line widths, picked in turn so rows don't look stamped out.
const WIDTHS = ["w-24", "w-36", "w-16", "w-28", "w-20", "w-32", "w-14", "w-24"]
const width = (index: number) => WIDTHS[index % WIDTHS.length]

// One still block. Sized by its className.
export function Bone({ className }: { className?: string }) {
  return <Skeleton className={cn("animate-none rounded-md bg-slate-100", className)} />
}

// The page's loading region: says what is loading to a screen reader and
// lays the blocks out with the page's own gap.
export function PageSkeleton({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return (
    <div role="status" aria-busy="true" className={cn("flex flex-col gap-6", className)}>
      <span className="sr-only">Loading {label}…</span>
      {children}
    </div>
  )
}

// The page heading, led by the loading emblem. `subline` adds the muted line
// under it; `actions` the buttons on the right (`pill` for Today's rounded
// ones); `avatar` puts the emblem where a lead's initials sit.
export function HeadingSkeleton({
  width: headingWidth = "w-44",
  subline = false,
  actions = 0,
  pill = false,
  avatar = false,
}: {
  width?: string
  subline?: boolean
  actions?: number
  pill?: boolean
  avatar?: boolean
}) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className={cn("flex min-w-0 gap-3", avatar ? "items-start gap-4" : "items-center")}>
        {avatar ? (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-blue-50">
            <LogoLoader size={34} />
          </span>
        ) : (
          <LogoLoader size={40} />
        )}
        <div className="flex min-w-0 flex-col gap-2">
          <Bone className={cn("h-7 max-w-full", headingWidth)} />
          {subline && <Bone className="h-4 w-72 max-w-full" />}
        </div>
      </div>
      {actions > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: actions }, (_, index) => (
            <Bone key={index} className={cn("h-10 w-32", pill && "h-11 w-40 rounded-full")} />
          ))}
        </div>
      )}
    </div>
  )
}

// A filter row. `search` is the labelled search box with its button and hint;
// `fields` labelled selects or inputs; `chips` a row of small filter buttons.
export function ToolbarSkeleton({
  search = false,
  fields = 0,
  chips = 0,
}: {
  search?: boolean
  fields?: number
  chips?: number
}) {
  return (
    <div className="flex flex-col gap-4">
      {search && (
        <div className="flex max-w-xl flex-col gap-1.5">
          <Bone className="h-4 w-24" />
          <div className="flex gap-2">
            <Bone className="h-10 flex-1" />
            <Bone className="h-10 w-20" />
          </div>
          <Bone className="h-3 w-64 max-w-full" />
        </div>
      )}
      {fields > 0 && (
        <div className="flex flex-wrap gap-4">
          {Array.from({ length: fields }, (_, index) => (
            <div key={index} className="flex w-56 flex-col gap-1.5">
              <Bone className="h-4 w-16" />
              <Bone className="h-10 w-full" />
            </div>
          ))}
        </div>
      )}
      {chips > 0 && (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: chips }, (_, index) => (
            <Bone key={index} className={cn("h-8", index % 3 === 0 ? "w-24" : "w-20")} />
          ))}
        </div>
      )}
    </div>
  )
}

// A table in the list outline: a header band, then `rows` rows of `cols`
// cells. `summary` adds the "N leads" line above it.
export function TableSkeleton({ rows = 8, cols = 5, summary = true }: { rows?: number; cols?: number; summary?: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      {summary && <Bone className="h-4 w-20" />}
      <div className="overflow-hidden rounded-lg ring-1 ring-foreground/10">
        <div className="flex h-9 items-center gap-6 border-b bg-slate-50 px-3">
          {Array.from({ length: cols }, (_, col) => (
            <Bone key={col} className={cn("h-3 bg-slate-200/70", col === 0 ? "w-20" : "w-14")} />
          ))}
        </div>
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="flex h-11 items-center gap-6 border-b px-3 last:border-b-0">
            {Array.from({ length: cols }, (_, col) => (
              <Bone key={col} className={cn("h-3.5 shrink-0", width(row + col * 3))} />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

// A card: a title bar then `lines` lines of text. `className` places it in a
// grid or sets its height.
export function CardSkeleton({ lines = 3, title = true, className }: { lines?: number; title?: boolean; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10 sm:p-5", className)}>
      {title && <Bone className="h-5 w-36" />}
      {Array.from({ length: lines }, (_, index) => (
        <Bone key={index} className={cn("h-3.5", index === lines - 1 ? "w-2/3" : "w-full")} />
      ))}
    </div>
  )
}

// A divided list in one outline (follow-ups, fee schedules, Today's queue):
// `rows` rows of `lines` lines each. `bare` drops the outline, as the audit
// and a lead's history show their entries.
export function ListSkeleton({ rows = 4, lines = 2, bare = false }: { rows?: number; lines?: number; bare?: boolean }) {
  return (
    <div className={cn("flex flex-col divide-y", bare ? "max-w-3xl" : "rounded-xl ring-1 ring-foreground/10")}>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className={cn("flex flex-col gap-2", bare ? "py-3" : "p-4")}>
          {Array.from({ length: lines }, (_, line) => (
            <Bone key={line} className={cn("h-3.5", line === 0 ? "w-48 max-w-full" : width(row + line + 1))} />
          ))}
        </div>
      ))}
    </div>
  )
}
