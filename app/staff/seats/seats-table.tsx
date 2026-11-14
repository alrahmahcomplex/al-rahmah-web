"use client"

import { Table } from "@/components/kit"
import type { ClassSeats } from "@/lib/services/seats"

import { seatsLine, takenLine } from "./format"

// Seats by class: the seats set and the seats taken, split by Seat priority.
export function SeatsTable({ rows }: { rows: ClassSeats[] }) {
  return (
    <Table<ClassSeats>
      label="Seats by class"
      className="st-counts"
      rows={rows}
      rowKey={(entry) => `${entry.className}-${entry.dayOrBoarding}`}
      columns={[
        {
          header: "Class",
          cell: (entry) => (
            <b>
              {entry.className} {entry.dayOrBoarding}
            </b>
          ),
        },
        {
          header: "Seats",
          align: "end",
          cell: (entry) => (entry.seats === null ? <span className="st-muted">{seatsLine(entry)}</span> : seatsLine(entry)),
        },
        {
          header: "Taken",
          align: "end",
          cell: (entry) => {
            const over = entry.seats !== null && entry.taken > entry.seats
            const split = takenLine(entry)
            return (
              <>
                <span className={over ? "st-over" : undefined}>
                  {entry.taken}
                  {over && " · over capacity"}
                </span>
                {split && <small className="st-split">{split}</small>}
              </>
            )
          },
        },
      ]}
    />
  )
}
