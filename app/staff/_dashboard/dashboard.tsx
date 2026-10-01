import type { SupabaseClient } from "@supabase/supabase-js"

import { getMetricCount, listEnrollmentYears, type DashboardMetric } from "@/lib/services/dashboard"

import { parsePanelFilters } from "./filters"
import { DashboardPanel } from "./panel"

type SearchParams = { [key: string]: string | string[] | undefined }

// The single-number panels, in the order they appear. Each has its own key in
// the page address. Later dashboard tickets add a line here.
export const METRIC_TILES: { metric: DashboardMetric; key: string; title: string; counts: string }[] = [
  { metric: "visited_leads", key: "visited", title: "Visited leads", counts: "Counted by Visit date" },
]

// The dashboard on the staff home, for staff who may view leads. Rendered on
// every request, so the counts are always current.
export async function Dashboard({ supabase, searchParams }: { supabase: SupabaseClient; searchParams: SearchParams }) {
  const query = toURLSearchParams(searchParams)
  const [years, tiles] = await Promise.all([
    listEnrollmentYears(supabase),
    Promise.all(
      METRIC_TILES.map(async (tile) => {
        const filters = parsePanelFilters(searchParams, tile.key)
        return { ...tile, filters, count: await getMetricCount(supabase, tile.metric, filters) }
      }),
    ),
  ])
  const enrollmentYears = years.ok ? years.data : []

  return (
    <section aria-labelledby="dashboard-heading" className="flex flex-col gap-3">
      <h2 id="dashboard-heading" className="text-sm font-medium text-slate-900">
        Dashboard
      </h2>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => (
          <DashboardPanel
            key={tile.key}
            panelKey={tile.key}
            title={tile.title}
            filters={tile.filters}
            enrollmentYears={enrollmentYears}
            searchParams={query}
          >
            {tile.count.ok ? (
              <div className="flex flex-col">
                <p className="text-3xl font-semibold tabular-nums text-slate-900" data-testid={`${tile.key}-count`}>
                  {tile.count.data.toLocaleString("en-GB")}
                </p>
                <p className="text-xs text-muted-foreground">{tile.counts}</p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">This count could not be loaded. Try again in a moment.</p>
            )}
          </DashboardPanel>
        ))}
      </div>
    </section>
  )
}

function toURLSearchParams(params: SearchParams): URLSearchParams {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    const values = Array.isArray(value) ? value : value === undefined ? [] : [value]
    for (const each of values) query.append(key, each)
  }
  return query
}
