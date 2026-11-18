import type { SupabaseClient } from "@supabase/supabase-js"

import { getSeats, listFeeSchedules } from "./fees"
import type { DayOrBoarding, LeadClass } from "./leads"
import type { Result } from "./result"
import { getSeatMode, getYearStreams, type StreamTakes, type YearStreams } from "./streams"

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

/** One stream on Reports once streams are on (#449): its seats, the children placed in it by Seat priority, and its free seats. */
export type StreamSeatFigures = {
  id: string
  label: string
  takes: StreamTakes
  seats: number
  full: number
  firstInstalment: number
  deposit: number
  free: number
}

/**
 * A class on Reports once streams are on: its streams in order, its seat
 * holders by Seat priority (placed or not; what a class with no streams
 * shows), and how many wait for a stream.
 */
export type ClassStreamFigures = {
  className: LeadClass
  streams: StreamSeatFigures[]
  full: number
  firstInstalment: number
  deposit: number
  waiting: number
}

export type SeatsByClass = {
  // The year shown; null when no year has a Fee schedule.
  year: number | null
  // The years with a Fee schedule, newest first.
  years: number[]
  // Every class in class order, Day before Boarding. Empty when `year` is
  // null, and once streams are on, when `named` says it instead.
  classes: ClassSeatFigures[]
  // Once streams are on (#449): the year’s streams, as Seats reads them, and
  // with `figures` asked for, Reports’ counts by stream. Null before.
  named: { streams: YearStreams; figures: ClassStreamFigures[] | null } | null
}

// The seats in `year`, or in the latest year with a Fee schedule when `year`
// is left out or has none. Needs payments.view, checked here first, so a
// staff member without it gets `forbidden` and slice 9 is never asked.
export async function getSeatsByClass(
  supabase: SupabaseClient,
  year?: number | null,
  { figures = false }: { figures?: boolean } = {},
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
  if (shown === null) return { ok: true, data: { year: null, years, classes: [], named: null } }

  if ((await getSeatMode(supabase)) === "named") {
    const [streams, counted] = await Promise.all([getYearStreams(supabase, shown), figures ? yearSeatFigures(supabase, shown) : null])
    if (!streams.ok || (counted && !counted.ok)) return { ok: false, error: "unavailable" }
    return { ok: true, data: { year: shown, years, classes: [], named: { streams: streams.data, figures: counted?.ok ? counted.data : null } } }
  }

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
      named: null,
    },
  }
}

type FiguresRow = {
  classes: {
    class_name: LeadClass
    streams: { id: string; label: string; takes: StreamTakes; seats: number; full: number; first_instalment: number; deposit: number; free: number }[]
    full: number
    first_instalment: number
    deposit: number
    waiting: number
  }[]
}

// Reports’ counts by stream (year_seat_figures, payments.view). Counts only.
async function yearSeatFigures(supabase: SupabaseClient, year: number): Promise<Result<ClassStreamFigures[], "unavailable">> {
  const { data, error } = await supabase.rpc("year_seat_figures", { schedule_year: year })
  if (error) {
    console.error("Could not read the seats by stream", error)
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: (data as FiguresRow).classes.map((entry) => ({
      className: entry.class_name,
      streams: entry.streams.map((stream) => ({
        id: stream.id,
        label: stream.label,
        takes: stream.takes,
        seats: Number(stream.seats),
        full: Number(stream.full),
        firstInstalment: Number(stream.first_instalment),
        deposit: Number(stream.deposit),
        free: Number(stream.free),
      })),
      full: Number(entry.full),
      firstInstalment: Number(entry.first_instalment),
      deposit: Number(entry.deposit),
      waiting: Number(entry.waiting),
    })),
  }
}
