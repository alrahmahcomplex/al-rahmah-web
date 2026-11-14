import type { DayCounts } from "@/lib/services/home-stats"

// Home's two stat cards (#323): which days each reads, and what it shows.
// Dates are YYYY-MM-DD calendar days in Tanzania; weeks run Monday to Sunday.

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

function utc(date: string): Date {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

export function addDays(date: string, days: number): string {
  const moved = utc(date)
  moved.setUTCDate(moved.getUTCDate() + days)
  return moved.toISOString().slice(0, 10)
}

export function mondayOf(date: string): string {
  return addDays(date, -((utc(date).getUTCDay() + 6) % 7))
}

/** A real calendar date, or null for anything else. */
function calendarDate(value: string | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null
  return utc(value).toISOString().slice(0, 10) === value ? value : null
}

const format = (date: string, options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { ...options, timeZone: "UTC" }).format(utc(date))

/** "Wed 4 Nov". */
export function shortDay(date: string): string {
  return format(date, { weekday: "short", day: "numeric", month: "short" }).replace(",", "")
}

/** "12–18 Oct", or "28 Oct–3 Nov" across two months. */
export function shortRange(from: string, to: string): string {
  const month = (date: string) => format(date, { month: "short" })
  const day = (date: string) => utc(date).getUTCDate()
  return from.slice(0, 7) === to.slice(0, 7) ? `${day(from)}–${day(to)} ${month(to)}` : `${day(from)} ${month(from)}–${day(to)} ${month(to)}`
}

/** "Sunday 15 November", the date at the top of Home. */
export function homeDate(date: string): string {
  return format(date, { weekday: "long", day: "numeric", month: "long" }).replace(",", "")
}

/** The past day the Interviews card shows, from `?day=`; null for today. */
export function pickedDay(value: string | undefined, today: string): string | null {
  const day = calendarDate(value)
  return day && day < today ? day : null
}

/** The Monday of the past week the Applied card shows, from `?week=`; null for this week. */
export function pickedWeek(value: string | undefined, today: string): string | null {
  const day = calendarDate(value)
  if (!day) return null
  const monday = mondayOf(day)
  return monday < mondayOf(today) ? monday : null
}

export type StatPoint = { date: string; value: number }

export type StatCard = {
  value: number
  /** This number minus the one it is compared with. */
  change: number
  /** What it is compared with, for the trend's spoken label. */
  comparedWith: string
  /** The 7 days ending on the day or week shown. */
  days: StatPoint[]
  label: string
}

const sevenDaysTo = (end: string) => Array.from({ length: 7 }, (_, k) => addDays(end, k - 6))
const sum = (counts: DayCounts, from: string, to: string) => {
  let total = 0
  for (let day = from; day <= to; day = addDays(day, 1)) total += counts[day] ?? 0
  return total
}

/** The days the Interviews card reads: the 7 it draws and the same day a week before. */
export function interviewRange(day: string): { from: string; to: string } {
  return { from: addDays(day, -7), to: day }
}

export function interviewCard(day: string | null, today: string, counts: DayCounts): StatCard {
  const shown = day ?? today
  const value = counts[shown] ?? 0
  return {
    value,
    change: value - (counts[addDays(shown, -7)] ?? 0),
    comparedWith: day ? "the same day a week before" : "the same day last week",
    days: sevenDaysTo(shown).map((date) => ({ date, value: counts[date] ?? 0 })),
    label: day ? `Interviews on ${shortDay(day)}` : "Interviews today",
  }
}

/** The days the Applied card reads: the week before, through the last day it draws. */
export function appliedRange(week: string | null, today: string): { from: string; to: string } {
  const monday = week ?? mondayOf(today)
  return { from: addDays(monday, -7), to: week ? addDays(week, 6) : today }
}

export function appliedCard(week: string | null, today: string, counts: DayCounts): StatCard {
  const monday = week ?? mondayOf(today)
  const end = week ? addDays(week, 6) : today
  const value = sum(counts, monday, end)
  return {
    value,
    change: value - sum(counts, addDays(monday, -7), addDays(monday, -1)),
    comparedWith: week ? "the week before" : "last week",
    days: sevenDaysTo(end).map((date) => ({ date, value: counts[date] ?? 0 })),
    label: week ? `Applied ${shortRange(week, end)}` : "Applied this week",
  }
}
