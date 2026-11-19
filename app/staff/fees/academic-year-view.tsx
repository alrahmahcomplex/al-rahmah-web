"use client"

import { KeyValueList } from "@/components/kit"
import { formatDate } from "@/lib/school-calendar"
import type { FeeSchedule } from "@/lib/services/fees"

// A year's Academic-year start, read-only, for everyone who may read the
// schedule. Seats are on the Seats screen, in streams (#449).
export function AcademicYearView({ schedule }: { schedule: FeeSchedule }) {
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
    </div>
  )
}
