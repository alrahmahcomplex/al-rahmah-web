import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/school-calendar"
import type { FeeSchedule } from "@/lib/services/fees"
import { DAY_OR_BOARDING, LEAD_CLASSES } from "@/lib/services/leads"

// A year's Academic-year start and seat grid, read-only, for everyone who may
// read the schedule.
export function AcademicYearView({ schedule }: { schedule: FeeSchedule }) {
  const seatsOf = (className: string, dayOrBoarding: string) =>
    schedule.seats.find((seat) => seat.className === className && seat.dayOrBoarding === dayOrBoarding)?.seats

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Academic-year start</dt>
        <dd className="text-right">{schedule.academicYearStart ? formatDate(schedule.academicYearStart) : "Not set yet"}</dd>
      </dl>

      <section aria-labelledby="fees-seats" className="flex flex-col gap-2">
        <h3 id="fees-seats" className="text-sm font-semibold text-slate-900">
          Seats
        </h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Class</TableHead>
              {DAY_OR_BOARDING.map((choice) => (
                <TableHead key={choice} className="text-right">
                  {choice}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {LEAD_CLASSES.map((className) => (
              <TableRow key={className}>
                <TableCell className="font-medium">{className}</TableCell>
                {DAY_OR_BOARDING.map((choice) => {
                  const seats = seatsOf(className, choice)
                  return seats === undefined ? (
                    <TableCell key={choice} className="text-right text-muted-foreground">
                      Seats not set
                    </TableCell>
                  ) : (
                    <TableCell key={choice} className="text-right tabular-nums">
                      {seats}
                    </TableCell>
                  )
                })}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </div>
  )
}
