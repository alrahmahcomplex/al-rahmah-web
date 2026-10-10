import Link from "next/link"

import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { ClassSeatFigures, SeatsByClass } from "@/lib/services/dashboard"
import type { Result } from "@/lib/services/result"

import { takenLine } from "../seats/format"
import { SeatsYearFilter } from "./seats-year-filter"

// Seats by class: how full each class is in one Enrollment year, as it
// stands now. Counts only, never the leads holding the seats. Staff who
// manage academic years get a link to the Seats screen, where an over-full
// class's leads are ranked.
export function SeatsByClassPanel({
  seats,
  canOpenSeats,
  className,
}: {
  // Any refusal shows as could not be loaded; the dashboard leaves the panel
  // out for `forbidden`.
  seats: Result<SeatsByClass, unknown>
  canOpenSeats: boolean
  // Where the panel sits in the dashboard's grid.
  className?: string
}) {
  const year = seats.ok ? seats.data.year : null
  return (
    <Card size="sm" role="region" aria-labelledby="seats-heading" className={className}>
      <CardHeader>
        <CardTitle id="seats-heading" role="heading" aria-level={3}>
          Seats by class
        </CardTitle>
        <CardDescription data-testid="seats-period">
          Now{year !== null && ` · Enrollment year ${year}`}
        </CardDescription>
        {seats.ok && year !== null && (
          <CardAction>
            <SeatsYearFilter year={year} years={seats.data.years} />
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {!seats.ok ? (
          <p className="text-sm text-muted-foreground">These seats could not be loaded. Try again in a moment.</p>
        ) : year === null ? (
          <p className="text-sm text-muted-foreground">No fee schedule yet</p>
        ) : (
          <>
            <SeatsTable classes={seats.data.classes} />
            <p className="text-xs text-muted-foreground">
              A lead takes a seat once it has a Seat priority. Declined leads take none; Inactive and Archived leads keep theirs.
            </p>
            {canOpenSeats && (
              <Link
                href={`/staff/seats?year=${year}`}
                className="self-start text-xs font-medium text-slate-900 underline underline-offset-4"
              >
                Open the Seats screen
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function SeatsTable({ classes }: { classes: ClassSeatFigures[] }) {
  return (
    <Table aria-label="Seats by class">
      <TableHeader>
        <TableRow>
          <TableHead>Class</TableHead>
          <TableHead className="text-right">Seats</TableHead>
          <TableHead className="text-right">Taken</TableHead>
          <TableHead className="text-right">Left</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {classes.map((entry) => {
          const id = `${entry.className} ${entry.dayOrBoarding}`
          const quiet = entry.seats === null && entry.taken === 0
          const split = takenLine(entry)
          return (
            <TableRow key={id} data-testid={`seats-row-${id}`}>
              <TableCell className={`py-1.5 whitespace-normal ${quiet ? "text-muted-foreground" : "text-slate-900"}`}>
                {id}
              </TableCell>
              <TableCell
                className={`py-1.5 text-right whitespace-normal ${entry.seats === null ? "text-muted-foreground" : "tabular-nums text-slate-900"}`}
                data-testid="seats-set"
              >
                {entry.seats === null ? "Seats not set" : entry.seats.toLocaleString("en-GB")}
              </TableCell>
              <TableCell className="py-1.5 text-right whitespace-normal">
                <span className={`tabular-nums ${entry.taken === 0 ? "text-muted-foreground" : "text-slate-900"}`} data-testid="seats-taken">
                  {entry.taken.toLocaleString("en-GB")}
                </span>
                {split && (
                  <span className="block text-xs text-muted-foreground" data-testid="seats-priorities">
                    {split}
                  </span>
                )}
              </TableCell>
              <TableCell className="py-1.5 text-right whitespace-normal" data-testid="seats-left">
                {entry.overBy !== null ? (
                  <span className="font-semibold text-destructive">Over by {entry.overBy.toLocaleString("en-GB")}</span>
                ) : entry.left === null ? (
                  <>
                    <span className="text-muted-foreground" aria-hidden>
                      –
                    </span>
                    <span className="sr-only">Seats not set</span>
                  </>
                ) : (
                  <span className="tabular-nums text-slate-900">{entry.left.toLocaleString("en-GB")}</span>
                )}
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}
