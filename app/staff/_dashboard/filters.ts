import { formatDate } from "@/lib/school-calendar"
import { PERIOD_KINDS, type DashboardFilters, type Period, type PeriodKind } from "@/lib/services/dashboard"

// Each dashboard panel keeps its own filters in the page address, under its
// own key: `visited=week:2026-09-21` and `visited_year=2027`. The address
// carries only period kinds, dates and years. Anything missing or unreadable
// falls back to All time and All years.

type SearchParams = { [key: string]: string | string[] | undefined }

export const ALL_TIME: DashboardFilters = { period: { kind: "all" }, enrollmentYear: null }

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

// A real YYYY-MM-DD calendar date, or null.
export function calendarDate(value: string | undefined): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? "")
  if (!match) return null
  const [year, month, day] = match.slice(1).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  return real && year >= 2000 && year <= 2100 ? value! : null
}

function parsePeriod(value: string | undefined): Period {
  const parts = (value ?? "").split(":")
  if (parts.length !== 2) return { kind: "all" }
  const [kind, anchor] = parts
  if (!(PERIOD_KINDS as readonly string[]).includes(kind) || kind === "all") return { kind: "all" }
  const date = calendarDate(anchor)
  return date ? { kind: kind as Exclude<PeriodKind, "all">, anchor: date } : { kind: "all" }
}

function parseYear(value: string | undefined): number | null {
  if (!/^\d{4}$/.test(value ?? "")) return null
  const year = Number(value)
  return year >= 2000 && year <= 2100 ? year : null
}

// The filters the address gives one panel.
export function parsePanelFilters(params: SearchParams, key: string): DashboardFilters {
  return { period: parsePeriod(first(params[key])), enrollmentYear: parseYear(first(params[`${key}_year`])) }
}

// The staff home's address with one panel's filters changed and every other
// panel's left as they are. Defaults are left out.
export function panelHref(current: URLSearchParams, key: string, filters: DashboardFilters): string {
  const params = new URLSearchParams(current)
  const { period, enrollmentYear } = filters
  if (period.kind === "all") params.delete(key)
  else params.set(key, `${period.kind}:${period.anchor}`)
  if (enrollmentYear === null) params.delete(`${key}_year`)
  else params.set(`${key}_year`, String(enrollmentYear))
  const encoded = params.toString()
  return encoded ? `/staff?${encoded}` : "/staff"
}

// Arithmetic on YYYY-MM-DD dates, in UTC so the server's and the browser's
// time zones never shift a day.
function utc(date: string) {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function iso(date: Date) {
  return date.toISOString().slice(0, 10)
}

// The Monday of the week containing `date`.
export function mondayOf(date: string): string {
  const day = utc(date)
  const sinceMonday = (day.getUTCDay() + 6) % 7
  day.setUTCDate(day.getUTCDate() - sinceMonday)
  return iso(day)
}

// The anchor a newly chosen period kind starts on: the one containing today.
// A week is named by its Monday, a month by its first day, a year by 1 January.
export function anchorFor(kind: Exclude<PeriodKind, "all">, date: string): string {
  if (kind === "week") return mondayOf(date)
  if (kind === "month") return `${date.slice(0, 7)}-01`
  if (kind === "year") return `${date.slice(0, 4)}-01-01`
  return date
}

// What the panel says it shows, such as "Week of 21 Sep 2026".
export function periodLabel(period: Period): string {
  switch (period.kind) {
    case "all":
      return "All time"
    case "date":
      return formatDate(period.anchor)
    case "week":
      return `Week of ${formatDate(mondayOf(period.anchor))}`
    case "month":
      return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(utc(period.anchor))
    case "year":
      return period.anchor.slice(0, 4)
  }
}

// One string per distinct set of filters, for telling two sets apart.
export function filtersKey({ period, enrollmentYear }: DashboardFilters): string {
  return `${period.kind}:${period.kind === "all" ? "" : period.anchor}:${enrollmentYear ?? ""}`
}

export function isFiltered(filters: DashboardFilters): boolean {
  return filters.period.kind !== "all" || filters.enrollmentYear !== null
}
