import Link from "next/link"

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { DashboardFilters } from "@/lib/services/dashboard"

import { ALL_TIME, isFiltered, panelHref, periodLabel } from "./filters"
import { PanelFilter } from "./panel-filter"

// One dashboard panel: its title, the period and intake it shows, its filter
// icon, and a one-click way back to All time and All years. Every dashboard
// panel, tile or table, is one of these.
export function DashboardPanel({
  panelKey,
  title,
  filters,
  enrollmentYears,
  searchParams,
  children,
}: {
  panelKey: string
  title: string
  filters: DashboardFilters
  enrollmentYears: number[]
  // The whole page's query, so clearing this panel leaves the others alone.
  searchParams: URLSearchParams
  children: React.ReactNode
}) {
  const headingId = `${panelKey}-heading`
  return (
    <Card size="sm" role="region" aria-labelledby={headingId}>
      <CardHeader>
        <CardTitle id={headingId} role="heading" aria-level={3}>
          {title}
        </CardTitle>
        <CardDescription data-testid={`${panelKey}-period`}>
          {periodLabel(filters.period)}
          {" · "}
          {filters.enrollmentYear === null ? "All years" : `Enrollment year ${filters.enrollmentYear}`}
        </CardDescription>
        <CardAction>
          <PanelFilter panelKey={panelKey} title={title} filters={filters} enrollmentYears={enrollmentYears} />
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {children}
        {isFiltered(filters) && (
          <Link
            href={panelHref(searchParams, panelKey, ALL_TIME)}
            scroll={false}
            className="self-start text-xs font-medium text-slate-900 underline underline-offset-4"
          >
            Show all time and all years
          </Link>
        )}
      </CardContent>
    </Card>
  )
}
