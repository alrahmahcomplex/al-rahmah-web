import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The counts behind Home's two stat cards (#323, #519), from
// home_interviews_by_day and home_applications_by_day. Both read every record
// by its own date, imported or entered here, whatever admission year the
// child is applying for. They run on the caller's session, so row-level
// security decides what is counted: staff with leads.view count every lead
// and interview, anyone else counts none.

/** How many on each day, keyed by YYYY-MM-DD. A day with none is left out. */
export type DayCounts = Record<string, number>

type DayRow = { day: string } & Record<string, number | string>

async function countByDay(
  supabase: SupabaseClient,
  fn: "home_interviews_by_day" | "home_applications_by_day",
  column: string,
  from: string,
  to: string,
): Promise<Result<DayCounts, "unavailable">> {
  const { data, error } = await supabase.rpc(fn, { from_day: from, to_day: to })
  if (error) {
    // Someone signed out may not run it: they count none, as staff without leads.view do.
    if (error.code === "42501") return { ok: true, data: {} }
    console.error(`Could not count by day (${fn})`, error)
    return { ok: false, error: "unavailable" }
  }
  const counts: DayCounts = {}
  for (const row of (data ?? []) as DayRow[]) counts[row.day] = Number(row[column])
  return { ok: true, data: counts }
}

/**
 * The interviews on each day from `from` to `to` (YYYY-MM-DD in Tanzania,
 * both included): every child given an S/N, with a result or not, on the
 * date recorded with the result, else the day the S/N was given. One a
 * student import brought in counts on the child's Visit date from the file.
 */
export function countInterviewsByDay(supabase: SupabaseClient, from: string, to: string): Promise<Result<DayCounts, "unavailable">> {
  return countByDay(supabase, "home_interviews_by_day", "interview_count", from, to)
}

/**
 * The applications on each day from `from` to `to` (YYYY-MM-DD in Tanzania,
 * both included), by each student's own date: the day they were registered,
 * from the Admission form, the desk or an agent's code, or for one a student
 * import brought in, the Visit date from the file.
 */
export function countRegistrationsByDay(supabase: SupabaseClient, from: string, to: string): Promise<Result<DayCounts, "unavailable">> {
  return countByDay(supabase, "home_applications_by_day", "application_count", from, to)
}
