// Day-first dates and 24-hour times for the kit's DateField, DateTimeField
// and Calendar. A date travels as "YYYY-MM-DD" (what a native date input
// submits) and shows as "DD/MM/YYYY". Every step works on the date's numbers,
// never on a UTC instant, so no date moves by a day in a time zone behind UTC.

const pad = (n: number) => String(n).padStart(2, "0")

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const DAY_FIRST = /^\s*(\d{1,2})\s*[/.\- ]\s*(\d{1,2})\s*[/.\- ]\s*(\d{4})\s*$/
const TIME = /^\s*(\d{1,2})[:.]?(\d{2})\s*$/

/** Days in a month, `month` 1 to 12. */
export function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function iso(year: number, month: number, day: number) {
  return `${String(year).padStart(4, "0")}-${pad(month)}-${pad(day)}`
}

function realDay(year: number, month: number, day: number) {
  return year >= 1000 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)
}

/** A real "YYYY-MM-DD" date. */
export function isIsoDate(value: string) {
  const m = ISO.exec(value)
  return !!m && realDay(+m[1], +m[2], +m[3])
}

/**
 * What a person typed, day first ("25/09/2026", "5.9.2026", "5 9 2026"), as
 * "YYYY-MM-DD"; null for anything else, an impossible date ("31/02/2026") too.
 */
export function parseDayFirst(text: string): string | null {
  const m = DAY_FIRST.exec(text)
  if (!m) return null
  const [day, month, year] = [+m[1], +m[2], +m[3]]
  return realDay(year, month, day) ? iso(year, month, day) : null
}

/** "YYYY-MM-DD" as "DD/MM/YYYY"; "" when it is not a real date. */
export function showDayFirst(value: string) {
  if (!isIsoDate(value)) return ""
  const [year, month, day] = value.split("-")
  return `${day}/${month}/${year}`
}

/** A typed 24-hour time ("930", "9:30", "14.30") as "HH:MM"; null when it is not one. */
export function parseTime(text: string): string | null {
  const m = TIME.exec(text)
  if (!m) return null
  const [hours, minutes] = [+m[1], +m[2]]
  return hours < 24 && minutes < 60 ? `${pad(hours)}:${m[2]}` : null
}

/** A local calendar day as "YYYY-MM-DD", read from its own numbers. */
export function isoOf(date: Date) {
  return iso(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

/** "YYYY-MM-DD" as a local Date at midnight, for the calendar grid. */
export function localOf(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setFullYear(year)
  return date
}

/** Today on this device, "YYYY-MM-DD". */
export function todayIso() {
  return isoOf(new Date())
}

/** `value` moved by `days`, "YYYY-MM-DD". */
export function addDays(value: string, days: number) {
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate())
}

/** The Monday of the week `value` falls in, "YYYY-MM-DD". */
export function mondayOf(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  const weekday = (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
  return addDays(value, -weekday)
}

/** Whether `value` lies within the optional "YYYY-MM-DD" bounds. */
export function withinBounds(value: string, min?: string, max?: string) {
  return (!min || value >= min) && (!max || value <= max)
}

/** A `datetime-local` value ("YYYY-MM-DDTHH:MM") split into its date and time; "" for a missing part. */
export function splitDateTime(value: string): { date: string; time: string } {
  const [date = "", time = ""] = (value || "").split("T")
  return { date: isIsoDate(date) ? date : "", time: parseTime(time.slice(0, 5)) ?? "" }
}

/** A date and a time joined as a `datetime-local` value; "" unless both are complete. */
export function joinDateTime(date: string, time: string) {
  return date && time ? `${date}T${time}` : ""
}
