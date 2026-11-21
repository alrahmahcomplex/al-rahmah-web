// Dates at the school run on Tanzania time, whatever time zone the server or
// the browser is in. The database applies the same rule to a Visit date.
const TANZANIA = "Africa/Dar_es_Salaam"

// Today's date in Tanzania as YYYY-MM-DD.
export function tanzaniaToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TANZANIA, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)
}

// The enrollment years staff can choose: the current year and the next two.
export function enrollmentYears(now: Date = new Date()): number[] {
  const year = Number(tanzaniaToday(now).slice(0, 4))
  return [year, year + 1, year + 2]
}

// The school's current admission year for a Tanzania date (YYYY-MM-DD):
// the calendar year before 1 June, and the next calendar year from 1 June.
export function currentAdmissionYear(tanzaniaDate: string = tanzaniaToday()): number {
  const year = Number(tanzaniaDate.slice(0, 4))
  const month = Number(tanzaniaDate.slice(5, 7))
  return month >= 6 ? year + 1 : year
}

// The year a seats view opens on: the latest year with a Fee schedule up to
// the current admission year, or the earliest when every schedule is later.
// Null when there is none.
export function defaultSeatsYear(years: readonly number[], today: string = tanzaniaToday()): number | null {
  if (years.length === 0) return null
  const admissionYear = currentAdmissionYear(today)
  const upToCurrent = years.filter((year) => year <= admissionYear)
  return upToCurrent.length > 0 ? Math.max(...upToCurrent) : Math.min(...years)
}

// A YYYY-MM-DD date as a reader would say it, such as "29 Sep 2026".
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}

// The hour of the day in Tanzania, 0 to 23.
export function tanzaniaHour(now: Date = new Date()): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TANZANIA, hour: "numeric", hourCycle: "h23" }).format(now))
}

// A YYYY-MM-DD date written out in full, such as "Friday 6 November 2026".
export function formatLongDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(year, month - 1, day)))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((each) => each.type === type)?.value ?? ""
  return `${part("weekday")} ${part("day")} ${part("month")} ${part("year")}`
}
