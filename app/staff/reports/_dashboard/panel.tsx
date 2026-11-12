import Link from "next/link"
import type { ReactNode } from "react"

import { Card } from "@/components/kit"
import type { DashboardFilters } from "@/lib/services/dashboard"
import { cn } from "@/lib/utils"

import { ALL_TIME, isFiltered, panelHref, periodLabel } from "./filters"
import { PanelFilter } from "./panel-filter"

// The head of a dashboard card: its title (which names the card), the line
// under it, and the filter on the right.
export function PanelHead({
  headingId,
  title,
  period,
  periodTestId,
  filter,
}: {
  headingId: string
  title: string
  period: ReactNode
  periodTestId: string
  filter?: ReactNode
}) {
  return (
    <div className="rp-head">
      <div>
        <h2 id={headingId} className="kit-card-title">
          {title}
        </h2>
        <p className="rp-period" data-testid={periodTestId}>
          {period}
        </p>
      </div>
      {filter}
    </div>
  )
}

// One dashboard panel: its title, the period and intake it shows, its filter,
// and a one-click way back to All time and All years. Every dashboard panel,
// tile or table, is one of these.
export function DashboardPanel({
  panelKey,
  title,
  filters,
  enrollmentYears,
  searchParams,
  className,
  children,
}: {
  panelKey: string
  title: string
  filters: DashboardFilters
  enrollmentYears: number[]
  // The whole page's query, so clearing this panel leaves the others alone.
  searchParams: URLSearchParams
  // Where the panel sits in the dashboard's grid.
  className?: string
  children: ReactNode
}) {
  const headingId = `${panelKey}-heading`
  return (
    <Card aria-labelledby={headingId} className={cn("rp-panel", className)}>
      <PanelHead
        headingId={headingId}
        title={title}
        periodTestId={`${panelKey}-period`}
        period={
          <>
            {periodLabel(filters.period)}
            {" · "}
            {filters.enrollmentYear === null ? "All years" : `Enrollment year ${filters.enrollmentYear}`}
          </>
        }
        filter={<PanelFilter panelKey={panelKey} title={title} filters={filters} enrollmentYears={enrollmentYears} />}
      />
      {children}
      {isFiltered(filters) && (
        <Link href={panelHref(searchParams, panelKey, ALL_TIME)} scroll={false} className="rp-link">
          Show all time and all years
        </Link>
      )}
    </Card>
  )
}
