import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The dashboard module: every count on the staff home goes through here. It
// only reads. The counting, and the calendar arithmetic that turns a period
// into dates, happen in the database (dashboard_count), under the signed-in
// staff member's own permissions.

// The single-number metrics the database counts. Later dashboard tickets add
// theirs here and as a branch of dashboard_count.
export const DASHBOARD_METRICS = ["visited_leads"] as const
export type DashboardMetric = (typeof DASHBOARD_METRICS)[number]

export const PERIOD_KINDS = ["all", "date", "week", "month", "year"] as const
export type PeriodKind = (typeof PERIOD_KINDS)[number]

// When it happened. The anchor is a YYYY-MM-DD calendar date in Tanzania time;
// the period is the day, Monday-to-Sunday week, calendar month or calendar
// year that contains it.
export type Period = { kind: "all" } | { kind: Exclude<PeriodKind, "all">; anchor: string }

export type DashboardFilters = {
  period: Period
  // Which intake: the lead's current Enrollment year, or every year.
  enrollmentYear: number | null
}

export type DashboardError = "forbidden" | "invalid" | "unavailable"

function errorOf(error: { message: string; code: string }, what: string): DashboardError {
  if (error.message === "forbidden") return "forbidden"
  if (error.message === "invalid") return "invalid"
  // 42501: no execute permission, as for a visitor who is not signed in.
  if (error.code === "42501") return "forbidden"
  console.error(`Could not read ${what}`, error)
  return "unavailable"
}

// The number of `metric` in the period and Enrollment year.
export async function getMetricCount(
  supabase: SupabaseClient,
  metric: DashboardMetric,
  filters: DashboardFilters,
): Promise<Result<number, DashboardError>> {
  const { period, enrollmentYear } = filters
  const { data, error } = await supabase.rpc("dashboard_count", {
    metric,
    period_kind: period.kind,
    anchor: period.kind === "all" ? null : period.anchor,
    enrollment_year: enrollmentYear,
  })
  if (error) {
    // 22007/22008: an anchor that is not a calendar date.
    if (error.code === "22007" || error.code === "22008") return { ok: false, error: "invalid" }
    return { ok: false, error: errorOf(error, `the ${metric} count`) }
  }
  return { ok: true, data: Number(data) }
}

// The Enrollment years leads carry, newest first.
export async function listEnrollmentYears(supabase: SupabaseClient): Promise<Result<number[], DashboardError>> {
  const { data, error } = await supabase.rpc("dashboard_enrollment_years")
  if (error) return { ok: false, error: errorOf(error, "the enrollment years") }
  return { ok: true, data: (data as number[]).map(Number) }
}
