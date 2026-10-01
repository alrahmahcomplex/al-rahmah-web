import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { formatDate } from "@/lib/school-calendar"
import { BAND_NAMES, FEE_BANDS, type FeeSchedule } from "@/lib/services/fees"

import { bandClasses, formatShillings } from "./format"

const INSTALMENTS = [
  ["First", "first"],
  ["Second", "second"],
  ["Third", "third"],
] as const

// A year's schedule as read-only tables, for everyone who may read it.
export function ScheduleView({ schedule }: { schedule: FeeSchedule }) {
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="fees-annual" className="flex flex-col gap-2">
        <h2 id="fees-annual" className="text-sm font-semibold text-slate-900">
          Annual school fees
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Band</TableHead>
              <TableHead className="text-right">Day (TZS)</TableHead>
              <TableHead className="text-right">Boarding (TZS)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {FEE_BANDS.map((band) => (
              <TableRow key={band}>
                <TableCell className="whitespace-normal">
                  <span className="font-medium">{BAND_NAMES[band]}</span>
                  <span className="block text-xs text-muted-foreground">{bandClasses(band)}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatShillings(schedule.bands[band].day)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatShillings(schedule.bands[band].boarding)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="fees-instalments" className="flex flex-col gap-2">
        <h2 id="fees-instalments" className="text-sm font-semibold text-slate-900">
          Instalments
        </h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Instalment</TableHead>
              <TableHead className="text-right">Share</TableHead>
              <TableHead className="text-right">Due</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {INSTALMENTS.map(([label, key]) => (
              <TableRow key={key}>
                <TableCell>{label}</TableCell>
                <TableCell className="text-right tabular-nums">{schedule.split[key]}%</TableCell>
                <TableCell className="text-right">{formatDate(schedule.dueDates[key])}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>

      <section aria-labelledby="fees-other" className="flex flex-col gap-2">
        <h2 id="fees-other" className="text-sm font-semibold text-slate-900">
          Deposit and programmes
        </h2>
        <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Minimum Initial deposit</dt>
          <dd className="text-right tabular-nums">TZS {formatShillings(schedule.minimumDeposit)}</dd>
          <dt className="text-muted-foreground">Pre-Form One programme, Day</dt>
          <dd className="text-right tabular-nums">TZS {formatShillings(schedule.preFormOne.day)}</dd>
          <dt className="text-muted-foreground">Pre-Form One programme, Boarding</dt>
          <dd className="text-right tabular-nums">TZS {formatShillings(schedule.preFormOne.boarding)}</dd>
          <dt className="text-muted-foreground">Academic-year start</dt>
          <dd className="text-right">
            {schedule.academicYearStart ? formatDate(schedule.academicYearStart) : "Not set yet"}
          </dd>
        </dl>
      </section>
    </div>
  )
}
