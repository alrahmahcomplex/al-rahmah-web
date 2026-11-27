import type { SupabaseClient } from "@supabase/supabase-js"

import { LEAD_CLASSES, LEAD_STATUSES, type LeadClass, type LeadStatus } from "./leads"
import type { Result } from "./result"

// The counts behind Home's chart card (#405, #518), from home_chart_counts,
// and the admission years it can show, from home_admission_years. An
// application is a lead enrolling in the year asked for, imported records
// counted like any other; each counts once by month, class, status and
// source. Counts only: no row ever leaves the database.

export const APPLICATION_SOURCES = ["admission_form", "agent_code", "promo_code", "walk_in"] as const
export type ApplicationSource = (typeof APPLICATION_SOURCES)[number]

export type HomeChartCounts = {
  /**
   * Each month (YYYY-MM, Tanzania time) with an application dated in it, in
   * order. A record's date is the day it was created, or for an imported
   * record its Visit date from the file.
   */
  months: { month: string; count: number }[]
  /** Every class in school order, zeros included. */
  classes: { className: LeadClass; count: number }[]
  /** In LEAD_STATUSES order, zeros included. */
  statuses: { status: LeadStatus; count: number }[]
  /** In APPLICATION_SOURCES order, zeros included. An imported record with no code is a walk-in. */
  sources: { source: ApplicationSource; count: number }[]
  total: number
}

type Row = { dimension: "month" | "class" | "status" | "source"; bucket: string; application_count: number | string }

/**
 * The applications enrolling in `year`, by month, class, status and source. Needs
 * leads.view: anyone else gets `forbidden`.
 */
export async function getHomeChartCounts(supabase: SupabaseClient, year: number): Promise<Result<HomeChartCounts, "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("home_chart_counts", { year })
  if (error) {
    // `forbidden` from the function; 42501 for someone signed out.
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not count the year's applications for Home", error)
    return { ok: false, error: "unavailable" }
  }

  const rows = data as Row[]
  const counts = new Map<string, number>()
  for (const row of rows) counts.set(`${row.dimension}:${row.bucket}`, Number(row.application_count))
  const count = (dimension: Row["dimension"], bucket: string) => counts.get(`${dimension}:${bucket}`) ?? 0

  const months = rows
    .filter((row) => row.dimension === "month")
    .map((row) => ({ month: row.bucket, count: Number(row.application_count) }))
    .toSorted((a, b) => a.month.localeCompare(b.month))
  return {
    ok: true,
    data: {
      months,
      classes: LEAD_CLASSES.map((className) => ({ className, count: count("class", className) })),
      statuses: LEAD_STATUSES.map((status) => ({ status, count: count("status", status) })),
      sources: APPLICATION_SOURCES.map((source) => ({ source, count: count("source", source) })),
      total: months.reduce((sum, row) => sum + row.count, 0),
    },
  }
}

/**
 * Every admission year with at least one applicant, newest first. Needs
 * leads.view: anyone else gets `forbidden`.
 */
export async function getAdmissionYears(supabase: SupabaseClient): Promise<Result<number[], "forbidden" | "unavailable">> {
  const { data, error } = await supabase.rpc("home_admission_years")
  if (error) {
    if (error.message === "forbidden" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not list the admission years for Home", error)
    return { ok: false, error: "unavailable" }
  }
  return { ok: true, data: (data as { year: number }[]).map((row) => Number(row.year)) }
}
