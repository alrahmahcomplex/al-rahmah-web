import type { SupabaseClient } from "@supabase/supabase-js"

import { LEAD_CLASSES, type LeadClass } from "./leads"
import type { Result } from "./result"

// The dashboard module: every count on the staff home goes through here. It
// only reads. The counting, and the calendar arithmetic that turns a period
// into dates, happen in the database (dashboard_count), under the signed-in
// staff member's own permissions.

// The single-number metrics the database counts. Later dashboard tickets add
// theirs here and as a branch of dashboard_count. Interviewed leads counts
// children; Passed and Failed interviews count sittings, retakes included.
export const DASHBOARD_METRICS = ["visited_leads", "interviewed_leads", "passed_interviews", "failed_interviews"] as const
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
  // 22007/22008: an anchor that is not a calendar date.
  if (error.code === "22007" || error.code === "22008") return "invalid"
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
  if (error) return { ok: false, error: errorOf(error, `the ${metric} count`) }
  return { ok: true, data: Number(data) }
}

export type LeadsByClass = {
  // Every class in school order, DAY CARE to FORM 4, zeros included.
  classes: { className: LeadClass; count: number }[]
  total: number
}

// The leads created in the period and Enrollment year, per class. A lead
// counts by the date it was created in Tanzania time, whatever its status or
// closure mark, under its current class.
export async function getLeadsByClass(
  supabase: SupabaseClient,
  filters: DashboardFilters,
): Promise<Result<LeadsByClass, DashboardError>> {
  const { period, enrollmentYear } = filters
  const { data, error } = await supabase.rpc("dashboard_leads_by_class", {
    period_kind: period.kind,
    anchor: period.kind === "all" ? null : period.anchor,
    enrollment_year: enrollmentYear,
  })
  if (error) return { ok: false, error: errorOf(error, "the leads by enrollment class") }

  const counts = new Map((data as { class_name: LeadClass; lead_count: number | string }[]).map((row) => [row.class_name, Number(row.lead_count)]))
  const classes = LEAD_CLASSES.map((className) => ({ className, count: counts.get(className) ?? 0 }))
  return { ok: true, data: { classes, total: classes.reduce((sum, row) => sum + row.count, 0) } }
}

// The Enrollment years leads carry, newest first.
export async function listEnrollmentYears(supabase: SupabaseClient): Promise<Result<number[], DashboardError>> {
  const { data, error } = await supabase.rpc("dashboard_enrollment_years")
  if (error) return { ok: false, error: errorOf(error, "the enrollment years") }
  return { ok: true, data: (data as number[]).map(Number) }
}
