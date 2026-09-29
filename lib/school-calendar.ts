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

// A YYYY-MM-DD date as a reader would say it, such as "29 Sep 2026".
export function formatDate(date: string): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, day)),
  )
}
