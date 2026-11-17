import type { SupabaseClient } from "@supabase/supabase-js"

import { LEAD_CLASSES, type LeadClass } from "./leads"
import type { Result } from "./result"

// The counts behind Home's chart card (#405), from home_chart_counts. An
// application is a lead created in the calendar year in Tanzania time, not
// brought in by a student import; each counts once by month, once by class
// and once by source. Counts only: no row ever leaves the database.

export const APPLICATION_SOURCES = ["admission_form", "agent_code", "promo_code", "walk_in"] as const
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number]

export type HomeChartCounts = {
  /** January to December, zeros included. */
  months: number[]
  /** Every class in school order, zeros included. */
  classes: { className: LeadClass; count: number }[]
  /** In APPLICATION_SOURCES order, zeros included. */
  sources: { source: ApplicationSource; count: number }[]
  total: number
}

type Row = { dimension: "month" | "class" | "source"; bucket: string; application_count: number | string }

/**
 * This year's applications by month, class and source. Needs leads.view:
 * anyone else gets `forbidden`.
 */
export async function getHomeChartCounts(supabase: SupabaseClient, year: number): Promise<Result<HomeChartCounts, "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("home_chart_counts", { year })
  if (error) {
    // `forbidden` from the function; 42501 for someone signed out.
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not count this year's applications for Home", error)
    return { ok: false, error: "unavailable" }
  }

  const counts = new Map<string, number>()
  for (const row of data as Row[]) counts.set(`${row.dimension}:${row.bucket}`, Number(row.application_count))
  const count = (dimension: Row["dimension"], bucket: string) => counts.get(`${dimension}:${bucket}`) ?? 0

  const months = Array.from({ length: 12 }, (_, i) => count("month", String(i + 1).padStart(2, "0")))
  return {
    ok: true,
    data: {
      months,
      classes: LEAD_CLASSES.map((className) => ({ className, count: count("class", className) })),
      sources: APPLICATION_SOURCES.map((source) => ({ source, count: count("source", source) })),
      total: months.reduce((sum, n) => sum + n, 0),
    },
  }
}
