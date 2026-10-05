import type { Metadata } from "next"
import Link from "next/link"
import { forbidden } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { tanzaniaToday } from "@/lib/school-calendar"
import { listFeeSchedules } from "@/lib/services/fees"
import { getSeats } from "@/lib/services/seats"
import { createClient } from "@/utils/supabase/server"

import { parseScheduleYear } from "../fees/years"
import { requireStaff } from "../session"
import { defaultSeatsYear, seatsLine, takenLine } from "./format"
import { RankedClass } from "./ranked-class"

export const metadata: Metadata = {
  title: "Seats · Al-Rahmah Complex",
}

// How full each class is in a year, and, for each class with more leads
// holding a Seat priority than seats, its leads ranked so the Admissions
// Manager can decide who keeps a place. For staff who manage academic years;
// the counts sit behind payments.view in the database.
export default async function SeatsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("academic_years.manage")) forbidden()

  if (!staff.permissions.includes("payments.view")) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Seats</h1>
        <p className="text-sm text-slate-700">Seats are shown only to staff who can view payments.</p>
      </div>
    )
  }

  const supabase = await createClient()
  const schedules = await listFeeSchedules(supabase)
  const years = schedules.ok ? schedules.data.map((schedule) => schedule.year).toSorted((a, b) => a - b) : []
  const { year: requested } = await searchParams
  const year = requested === undefined ? defaultSeatsYear(years, tanzaniaToday()) : parseScheduleYear(requested)
  const seats = year === null ? null : await getSeats(supabase, year)
  const overFull = seats?.ok ? seats.data.filter((entry) => entry.ranked !== null) : []

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Seats{year !== null && ` ${year}`}</h1>

      {years.length > 0 && (
        <nav aria-label="Enrollment years" className="flex flex-wrap gap-2 text-sm">
          {years.map((each) => (
            <Link
              key={each}
              href={`/staff/seats?year=${each}`}
              aria-current={each === year ? "page" : undefined}
              className="rounded-md px-2.5 py-1 ring-1 ring-foreground/10 hover:bg-muted/50 aria-[current=page]:bg-muted aria-[current=page]:font-semibold"
            >
              {each}
            </Link>
          ))}
        </nav>
      )}

      {!schedules.ok || (seats !== null && !seats.ok) ? (
        <Alert variant="destructive">
          <AlertDescription>The seats could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : year === null ? (
        <p className="text-sm text-slate-700">
          {requested === undefined ? "No fee schedule has been set up yet, so there are no seats to count." : "Choose a year from 2000 to 2999."}
        </p>
      ) : (
        seats?.ok && (
          <>
            {overFull.length > 0 && (
              <section aria-labelledby="seats-over-capacity" className="flex flex-col gap-4">
                <h2 id="seats-over-capacity" className="text-base font-semibold text-slate-900">
                  Over capacity
                </h2>
                {overFull.map((entry) => (
                  <RankedClass key={`${entry.className}-${entry.dayOrBoarding}`} entry={entry} />
                ))}
              </section>
            )}

            <section aria-labelledby="seats-by-class" className="flex flex-col gap-2">
              <h2 id="seats-by-class" className="text-base font-semibold text-slate-900">
                Seats by class
              </h2>
              <p className="text-sm text-muted-foreground">
                A lead takes a seat once it has a Seat priority. Declined leads take none; Inactive and Archived leads keep theirs.
              </p>
              <Table aria-label="Seats by class">
                <TableHeader>
                  <TableRow>
                    <TableHead>Class</TableHead>
                    <TableHead className="text-right">Seats</TableHead>
                    <TableHead className="text-right">Taken</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {seats.data.map((entry) => {
                    const over = entry.seats !== null && entry.taken > entry.seats
                    const split = takenLine(entry)
                    return (
                      <TableRow key={`${entry.className}-${entry.dayOrBoarding}`}>
                        <TableCell className="font-medium whitespace-normal">
                          {entry.className} {entry.dayOrBoarding}
                        </TableCell>
                        <TableCell
                          className={
                            entry.seats === null
                              ? "text-right whitespace-normal text-muted-foreground"
                              : "text-right tabular-nums"
                          }
                        >
                          {seatsLine(entry)}
                        </TableCell>
                        <TableCell className="text-right whitespace-normal">
                          <span className={over ? "font-semibold tabular-nums text-destructive" : "tabular-nums"}>
                            {entry.taken}
                            {over && " · over capacity"}
                          </span>
                          {split && <span className="block text-xs text-muted-foreground">{split}</span>}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </section>
          </>
        )
      )}
    </div>
  )
}
