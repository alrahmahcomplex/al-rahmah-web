"use client"

import Link from "next/link"

import { Card, EmptyState, Table, Tag } from "@/components/kit"
import type { ClassSeatFigures, ClassStreamFigures, SeatsByClass, StreamSeatFigures } from "@/lib/services/dashboard"
import type { Result } from "@/lib/services/result"
import { cn } from "@/lib/utils"

import { takenLine } from "../../seats/format"
import { TakesTag } from "../../seats/stream-sheets"
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
          {seats.data.named?.figures ? <StreamSeatsTable classes={seats.data.named.figures} /> : <SeatsTable classes={seats.data.classes} />}
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

// Once streams are on (#449, prototype v42): one row per stream under its
// class, then the class total with how many wait for a stream. A class with no
// streams shows only its total: its seats are not set, and its children with
// a Seat priority count by priority (lead, 2026-11-19).
type StreamRow =
  | { kind: "class"; id: string; className: string }
  | { kind: "stream"; id: string; className: string; stream: StreamSeatFigures }
  | { kind: "total"; id: string; entry: ClassStreamFigures }

function streamRows(classes: readonly ClassStreamFigures[]): StreamRow[] {
  return classes.flatMap((entry): StreamRow[] => [
    ...(entry.streams.length > 0 ? [{ kind: "class" as const, id: `${entry.className} class`, className: entry.className }] : []),
    ...entry.streams.map((stream) => ({ kind: "stream" as const, id: stream.id, className: entry.className, stream })),
    { kind: "total" as const, id: `${entry.className} total`, entry },
  ])
}

const count = (n: number) => n.toLocaleString("en-GB")
const sum = (streams: readonly StreamSeatFigures[], pick: (s: StreamSeatFigures) => number) => streams.reduce((total, s) => total + pick(s), 0)

// A column’s figure for a stream, or for a class total: the streams added up,
// or, for a class with no streams, its seat holders.
function figure(row: StreamRow, pick: (s: StreamSeatFigures) => number, holders?: (e: ClassStreamFigures) => number) {
  if (row.kind === "class") return null
  if (row.kind === "stream") return count(pick(row.stream))
  const { entry } = row
  if (entry.streams.length > 0) return <b>{count(sum(entry.streams, pick))}</b>
  return holders ? <b>{count(holders(entry))}</b> : null
}

function StreamSeatsTable({ classes }: { classes: ClassStreamFigures[] }) {
  return (
    <Table<StreamRow>
      label="Seats in each stream"
      rows={streamRows(classes)}
      rowKey={(row) => row.id}
      columns={[
        {
          header: "Stream",
          cell: (row) =>
            row.kind === "class" ? (
              <b>{row.className}</b>
            ) : row.kind === "stream" ? (
              `${row.className} ${row.stream.label}`
            ) : (
              <b>{row.entry.className} total</b>
            ),
        },
        {
          header: "Takes",
          cell: (row) =>
            row.kind === "stream" ? <TakesTag takes={row.stream.takes} /> : row.kind === "total" && row.entry.waiting > 0 ? <Tag tone="wait">{count(row.entry.waiting)} waiting</Tag> : null,
        },
        {
          header: "Seats",
          align: "end",
          cell: (row) =>
            row.kind === "total" && row.entry.streams.length === 0 ? <span className="rp-quiet">Seats not set</span> : figure(row, (s) => s.seats),
        },
        { header: "Full", align: "end", cell: (row) => figure(row, (s) => s.full, (e) => e.full) },
        { header: "First instalment", align: "end", cell: (row) => figure(row, (s) => s.firstInstalment, (e) => e.firstInstalment) },
        { header: "Deposit", align: "end", cell: (row) => figure(row, (s) => s.deposit, (e) => e.deposit) },
        {
          header: "Free",
          align: "end",
          cell: (row) =>
            row.kind === "total" && row.entry.streams.length === 0 ? (
              <>
                <span className="rp-quiet" aria-hidden>
                  –
                </span>
                <span className="sr-only">Seats not set</span>
              </>
            ) : (
              figure(row, (s) => s.free)
            ),
        },
      ]}
    />
  )
}
