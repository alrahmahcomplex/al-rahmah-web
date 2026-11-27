import type { SupabaseClient } from "@supabase/supabase-js"

import { defaultSeatsYear, tanzaniaToday } from "@/lib/school-calendar"

import { listFeeSchedules } from "./fees"
import type { LeadClass } from "./leads"
import type { Result } from "./result"
import { getYearStreams, type StreamTakes, type YearStreams } from "./streams"

// Seats by class, for Home and Reports: how full each class's streams (#449)
// are in one Enrollment year. Home reads the year's streams as Seats does, on
// the server. Reports reads counts by stream alone, since it hands them to
// the browser and the streams name the children waiting.

/** One stream on Reports: its seats, the children placed in it by Seat priority, and its free seats. */
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
 * A class on Reports: its streams in order, its seat holders by Seat priority
 * (placed or not; what a class with no streams shows), and how many wait for
 * a stream.
 */
export type ClassStreamFigures = {
  className: LeadClass
  streams: StreamSeatFigures[]
  full: number
  firstInstalment: number
  deposit: number
  waiting: number
}

type ShownYear = {
  // The year shown; null when no year has a Fee schedule.
  year: number | null
  // The years with a Fee schedule, newest first.
  years: number[]
}

/** Home's seats: the year's streams as Seats reads them; null when `year` is. */
export type SeatsByClass = ShownYear & { streams: YearStreams | null }

/** Reports' seats: counts by stream, every class in class order; empty when `year` is null. */
export type SeatFiguresByClass = ShownYear & { classes: ClassStreamFigures[] }

// The year to show: `year`, or the default seats year (the latest year with a
// Fee schedule up to the current admission year, or the earliest when every
// schedule is later) when `year` is left out or has none. Needs payments.view,
// checked here first, so a staff member without it gets `forbidden` and no
// seat is read.
async function shownYear(
  supabase: SupabaseClient,
  year: number | null | undefined,
  today: string = tanzaniaToday(),
): Promise<Result<ShownYear, "forbidden" | "unavailable">> {
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
  const chosen = year != null && years.includes(year) ? year : defaultSeatsYear(years, today)
  return { ok: true, data: { year: chosen, years } }
}

/** Home's seats in `year` (see shownYear). */
export async function getSeatsByClass(
  supabase: SupabaseClient,
  year?: number | null,
  today?: string,
): Promise<Result<SeatsByClass, "forbidden" | "unavailable">> {
  const shown = await shownYear(supabase, year, today)
  if (!shown.ok) return shown
  if (shown.data.year === null) return { ok: true, data: { ...shown.data, streams: null } }
  const streams = await getYearStreams(supabase, shown.data.year)
  if (!streams.ok) return { ok: false, error: "unavailable" }
  return { ok: true, data: { ...shown.data, streams: streams.data } }
}

/** Reports' counts by stream in `year` (see shownYear). Counts only. */
export async function getSeatFiguresByClass(
  supabase: SupabaseClient,
  year?: number | null,
  today?: string,
): Promise<Result<SeatFiguresByClass, "forbidden" | "unavailable">> {
  const shown = await shownYear(supabase, year, today)
  if (!shown.ok) return shown
  if (shown.data.year === null) return { ok: true, data: { ...shown.data, classes: [] } }
  const counted = await yearSeatFigures(supabase, shown.data.year)
  if (!counted.ok) return counted
  return { ok: true, data: { ...shown.data, classes: counted.data } }
}

type FiguresRow = {
  classes: {
    class_name: LeadClass
    streams: { id: string; label: string | null; takes: StreamTakes; seats: number; full: number; first_instalment: number; deposit: number; free: number }[]
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
        label: stream.label ?? "",
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
