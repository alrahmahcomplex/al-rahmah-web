import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The counts behind Home's two stat cards (#323). Both are read on the
// caller's session, so row-level security decides what is counted: staff
// with leads.view count every lead and interview, anyone else counts none.

// Tanzania keeps UTC+3 all year, so a calendar day there starts at 21:00 UTC
// the day before.
const TANZANIA_OFFSET = "+03:00"

/** How many on each day, keyed by YYYY-MM-DD. A day with none is left out. */
export type DayCounts = Record<string, number>

type DayRow = { day: string }

// Rows come back in pages of at most the API's row limit. A count higher than
// the rows read means some were cut off, and a short count is never shown.
function byDay(rows: DayRow[], count: number | null, what: string): Result<DayCounts, "unavailable"> {
  if (count === null || count > rows.length) {
    console.error(`Could not read every ${what}: ${count} counted, ${rows.length} read`)
    return { ok: false, error: "unavailable" }
  }
  const counts: DayCounts = {}
  for (const row of rows) counts[row.day] = (counts[row.day] ?? 0) + 1
  return { ok: true, data: counts }
}

/**
 * The interview sittings on each day from `from` to `to` (YYYY-MM-DD, both
 * included). A sitting's date is the one recorded with its result, so this
 * counts interviews held, not a schedule.
 */
export async function countInterviewsByDay(supabase: SupabaseClient, from: string, to: string): Promise<Result<DayCounts, "unavailable">> {
  const { data, count, error } = await supabase
    .from("interviews")
    .select("day:interview_date", { count: "exact" })
    .gte("interview_date", from)
    .lte("interview_date", to)
    .overrideTypes<DayRow[], { merge: false }>()
  if (error) {
    console.error("Could not count the interviews by day", error)
    return { ok: false, error: "unavailable" }
  }
  return byDay(data ?? [], count, "interview")
}

/**
 * The students registered on each day from `from` to `to` (YYYY-MM-DD in
 * Tanzania, both included), from the Admission form, the desk or an agent's
 * code. Students brought in by a student import are not counted: they were
 * not registered that day.
 */
export async function countRegistrationsByDay(supabase: SupabaseClient, from: string, to: string): Promise<Result<DayCounts, "unavailable">> {
  const { data, count, error } = await supabase
    .from("leads")
    .select("created_at", { count: "exact" })
    .is("import_batch_id", null)
    .gte("created_at", `${from}T00:00:00${TANZANIA_OFFSET}`)
    .lt("created_at", `${nextDay(to)}T00:00:00${TANZANIA_OFFSET}`)
    .overrideTypes<{ created_at: string }[], { merge: false }>()
  if (error) {
    console.error("Could not count the registrations by day", error)
    return { ok: false, error: "unavailable" }
  }
  return byDay(
    (data ?? []).map((row) => ({ day: tanzaniaDay(row.created_at) })),
    count,
    "registration",
  )
}

function nextDay(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10)
}

// The Tanzania calendar day of a timestamp.
function tanzaniaDay(timestamp: string): string {
  return new Date(new Date(timestamp).getTime() + 3 * 3600_000).toISOString().slice(0, 10)
}
