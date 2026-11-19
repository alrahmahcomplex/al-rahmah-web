// The year the screen opens on: the latest year with a Fee schedule up to
// next year, the year admissions are for, or the earliest when every
// schedule is later. Null when there is none.
export function defaultSeatsYear(years: readonly number[], today: string): number | null {
  if (years.length === 0) return null
  const nextYear = Number(today.slice(0, 4)) + 1
  const upToNext = years.filter((year) => year <= nextYear)
  return upToNext.length > 0 ? Math.max(...upToNext) : Math.min(...years)
}
