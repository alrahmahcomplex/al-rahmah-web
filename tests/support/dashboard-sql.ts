import type { Client } from "pg"

import type { DashboardMetric, Period } from "@/lib/services/dashboard"
import { LEAD_CLASSES } from "@/lib/services/leads"

import { actAsStaff } from "./db"

// The dashboard's database functions, called the way lib/services/dashboard.ts
// calls them, on a direct connection. A test that reads many counts and
// compares them runs these inside inOneSnapshot, signed in with actAsStaff,
// so every count sees the same leads whatever other tests write meanwhile.

// Runs `read` signed in as `staffId` in a transaction of its own on `sql`, a
// plain connection such as whileUnchanged's, and rolls it back.
export async function readAs<T>(sql: Client, staffId: string, read: (sql: Client) => Promise<T>): Promise<T> {
  await sql.query("begin")
  try {
    await actAsStaff(sql, staffId)
    return await read(sql)
  } finally {
    await sql.query("rollback")
  }
}

const anchorOf = (period: Period) => (period.kind === "all" ? null : period.anchor)

export async function enrollmentYearsIn(sql: Client): Promise<number[]> {
  const { rows } = await sql.query<{ year: number }>("select y as year from public.dashboard_enrollment_years() y")
  return rows.map((row) => Number(row.year))
}

export async function countIn(sql: Client, metric: DashboardMetric, period: Period, enrollmentYear: number | null): Promise<number> {
  const { rows } = await sql.query<{ count: string }>("select public.dashboard_count($1, $2, $3, $4) as count", [
    metric,
    period.kind,
    anchorOf(period),
    enrollmentYear,
  ])
  return Number(rows[0].count)
}

// Every class in school order, zeros included, as getLeadsByClass gives them.
export async function byClassIn(sql: Client, period: Period, enrollmentYear: number | null): Promise<number[]> {
  const { rows } = await sql.query<{ class_name: string; lead_count: string }>(
    "select class_name::text, lead_count from public.dashboard_leads_by_class($1, $2, $3)",
    [period.kind, anchorOf(period), enrollmentYear],
  )
  const counts = new Map(rows.map((row) => [row.class_name, Number(row.lead_count)]))
  return LEAD_CLASSES.map((className) => counts.get(className) ?? 0)
}
