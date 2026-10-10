import type { SupabaseClient } from "@supabase/supabase-js"

import { getSeats, listFeeSchedules } from "./fees"
import type { DayOrBoarding, LeadClass } from "./leads"
import type { Result } from "./result"

// Seats by class on the dashboard: a snapshot of how full each class is in
// one Enrollment year, read from slice 9's seat count. Counts only: the
// ranked leads slice 9 adds for an over-full class never leave this file.

export type ClassSeatFigures = {
  className: LeadClass
  dayOrBoarding: DayOrBoarding
  // Null when the seats are not set.
  seats: number | null
  taken: number
  full: number
  firstInstalment: number
  deposit: number
  // Seats set minus seats taken, never below zero. Null when the seats are
  // not set.
  left: number | null
  // How many more seats are taken than set; null unless the class is over.
  overBy: number | null
}

export type SeatsByClass = {
  // The year shown; null when no year has a Fee schedule.
  year: number | null
  // The years with a Fee schedule, newest first.
  years: number[]
  // Every class in class order, Day before Boarding. Empty when `year` is null.
  classes: ClassSeatFigures[]
}

// The seats in `year`, or in the latest year with a Fee schedule when `year`
// is left out or has none. Needs payments.view, checked here first, so a
// staff member without it gets `forbidden` and slice 9 is never asked.
export async function getSeatsByClass(
  supabase: SupabaseClient,
  year?: number | null,
): Promise<Result<SeatsByClass, "forbidden" | "unavailable">> {
  const permitted = await supabase.rpc("has_permission", { permission: "payments.view" })
  if (permitted.error) {
    // 42501: not signed in, so the function may not be called at all.
    if (permitted.error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not check the permission to view seats", permitted.error)
    return { ok: false, error: "unavailable" }
  }
  if (permitted.data !== true) return { ok: false, error: "forbidden" }

  const schedules = await listFeeSchedules(supabase)
  if (!schedules.ok) return schedules
  const years = schedules.data.map((schedule) => schedule.year).toSorted((a, b) => b - a)
  const shown = year != null && years.includes(year) ? year : (years[0] ?? null)
  if (shown === null) return { ok: true, data: { year: null, years, classes: [] } }

  const seats = await getSeats(supabase, shown)
  if (!seats.ok) return seats
  return {
    ok: true,
    data: {
      year: shown,
      years,
      // Field by field, so nothing slice 9 adds, the ranked leads among it,
      // reaches the dashboard.
      classes: seats.data.map((entry) => ({
        className: entry.className,
        dayOrBoarding: entry.dayOrBoarding,
        seats: entry.seats,
        taken: entry.taken,
        full: entry.full,
        firstInstalment: entry.firstInstalment,
        deposit: entry.deposit,
        left: entry.seats === null ? null : Math.max(entry.seats - entry.taken, 0),
        overBy: entry.seats !== null && entry.taken > entry.seats ? entry.taken - entry.seats : null,
      })),
    },
  }
}
