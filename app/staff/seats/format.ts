import type { ClassSeats } from "@/lib/services/seats"

// The seats set, as the Seats screen shows them.
export function seatsLine({ seats }: ClassSeats): string {
  return seats === null ? "Seats not set" : String(seats)
}

// The seats taken split by Seat priority, leaving out priorities nobody
// holds: "Full 1 · Deposit 2".
export function takenLine({ full, firstInstalment, deposit }: ClassSeats): string {
  return (
    [
      ["Full", full],
      ["First instalment", firstInstalment],
      ["Deposit", deposit],
    ] as const
  )
    .filter(([, count]) => count > 0)
    .map(([name, count]) => `${name} ${count}`)
    .join(" · ")
}

// The year the screen opens on: the latest year with a Fee schedule up to
// next year, the year admissions are for, or the earliest when every
// schedule is later. Null when there is none.
export function defaultSeatsYear(years: readonly number[], today: string): number | null {
  if (years.length === 0) return null
  const nextYear = Number(today.slice(0, 4)) + 1
  const upToNext = years.filter((year) => year <= nextYear)
  return upToNext.length > 0 ? Math.max(...upToNext) : Math.min(...years)
}
