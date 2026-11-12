"use client"

import Link from "next/link"

import { Card, EmptyState, Table } from "@/components/kit"
import type { ClassSeatFigures, SeatsByClass } from "@/lib/services/dashboard"
import type { Result } from "@/lib/services/result"
import { cn } from "@/lib/utils"

import { takenLine } from "../../seats/format"
import { PanelHead } from "./panel"
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
    <Card aria-labelledby="seats-heading" className={cn("rp-panel", className)}>
      <PanelHead
        headingId="seats-heading"
        title="Seats by class"
        periodTestId="seats-period"
        period={<>Now{year !== null && ` · Enrollment year ${year}`}</>}
        filter={seats.ok && year !== null ? <SeatsYearFilter year={year} years={seats.data.years} /> : undefined}
      />
      {!seats.ok ? (
        <p className="rp-err">These seats could not be loaded. Try again in a moment.</p>
      ) : year === null ? (
        <EmptyState title="No fee schedule yet" />
      ) : (
        <>
          <SeatsTable classes={seats.data.classes} />
          <p className="rp-cap">
            An applicant takes a seat once they have a Seat priority. Declined applicants take none; Inactive and Archived applicants keep theirs.
          </p>
          {canOpenSeats && (
            <Link href={`/staff/seats?year=${year}`} className="rp-link">
              Open the Seats screen
            </Link>
          )}
        </>
      )}
    </Card>
  )
}

function SeatsTable({ classes }: { classes: ClassSeatFigures[] }) {
  return (
    <Table
      label="Seats in each class"
      rows={classes.map((entry) => ({ ...entry, id: `${entry.className} ${entry.dayOrBoarding}` }))}
      rowKey={(entry) => entry.id}
      columns={[
        {
          header: "Class",
          cell: (entry) => (
            <span className={entry.seats === null && entry.taken === 0 ? "rp-quiet" : undefined} data-testid={`seats-row-${entry.id}`}>
              {entry.id}
            </span>
          ),
        },
        {
          header: "Seats",
          align: "end",
          cell: (entry) => (
            <span className={entry.seats === null ? "rp-quiet" : undefined} data-testid="seats-set">
              {entry.seats === null ? "Seats not set" : entry.seats.toLocaleString("en-GB")}
            </span>
          ),
        },
        {
          header: "Taken",
          align: "end",
          cell: (entry) => {
            const split = takenLine(entry)
            return (
              <>
                <span className={entry.taken === 0 ? "rp-quiet" : undefined} data-testid="seats-taken">
                  {entry.taken.toLocaleString("en-GB")}
                </span>
                {split && (
                  <span className="rp-split" data-testid="seats-priorities">
                    {split}
                  </span>
                )}
              </>
            )
          },
        },
        {
          header: "Left",
          align: "end",
          cell: (entry) => (
            <span data-testid="seats-left">
              {entry.overBy !== null ? (
                <span className="rp-over">Over by {entry.overBy.toLocaleString("en-GB")}</span>
              ) : entry.left === null ? (
                <>
                  <span className="rp-quiet" aria-hidden>
                    –
                  </span>
                  <span className="sr-only">Seats not set</span>
                </>
              ) : (
                entry.left.toLocaleString("en-GB")
              )}
            </span>
          ),
        },
      ]}
    />
  )
}
