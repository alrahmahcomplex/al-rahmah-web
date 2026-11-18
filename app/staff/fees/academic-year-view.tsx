"use client"

import { KeyValueList, Table } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import type { FeeSchedule } from "@/lib/services/fees"
import { DAY_OR_BOARDING, LEAD_CLASSES, type LeadClass } from "@/lib/services/leads"

// A year's Academic-year start and seat grid, read-only, for everyone who may
// read the schedule. Once streams are on (#449) the seats live on the Seats
// screen, so the grid goes.
export function AcademicYearView({ schedule, streamsOn = false }: { schedule: FeeSchedule; streamsOn?: boolean }) {
  const seatsOf = (className: string, dayOrBoarding: string) =>
    schedule.seats.find((seat) => seat.className === className && seat.dayOrBoarding === dayOrBoarding)?.seats

  return (
    <div>
      <KeyValueList
        className="fs-kv-end"
        items={[
          {
            key: "Academic-year start",
            value: schedule.academicYearStart ? formatDate(schedule.academicYearStart) : "Not set yet",
            numeric: true,
          },
        ]}
      />

      {!streamsOn && (
      <section aria-labelledby="fees-seats" className="kit-sec">
        <h3 id="fees-seats" className="kit-sec-title">
          Seats
        </h3>
        <Table<LeadClass>
          label="Seats in each class"
          className="fs-counts"
          rows={[...LEAD_CLASSES]}
          rowKey={(className) => className}
          columns={[
            { header: "Class", cell: (className) => <b>{className}</b> },
            ...DAY_OR_BOARDING.map((choice) => ({
              header: choice,
              align: "end" as const,
              cell: (className: LeadClass) => {
                const seats = seatsOf(className, choice)
                return seats === undefined ? <span className="fs-muted">Seats not set</span> : seats
              },
            })),
          ]}
        />
      </section>
      )}
    </div>
  )
}
