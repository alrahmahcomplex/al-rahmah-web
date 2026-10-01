import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { getFeeSchedule } from "@/lib/services/fees"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { AcademicYearEditor } from "../academic-year-editor"
import { AcademicYearView } from "../academic-year-view"
import { ScheduleEditor } from "../schedule-editor"
import { ScheduleView } from "../schedule-view"
import {
  canEditAcademicYear,
  canEditFeeAmounts,
  canReadFeeSchedule,
  canSeeFeeAmounts,
  NOT_SHOWN_WITHOUT_PAYMENTS_VIEW,
  parseScheduleYear,
} from "../years"

export const metadata: Metadata = {
  title: "Fee schedule · Al-Rahmah Complex",
}

// One enrollment year's Fee schedule. The amounts are editable for staff who
// may record payments, the Academic-year start and seats for staff who manage
// academic years, and everything is read-only for everyone else who may open it.
export default async function FeeSchedulePage({ params }: { params: Promise<{ year: string }> }) {
  const staff = await requireStaff()
  if (!canReadFeeSchedule(staff.permissions)) forbidden()
  const canEdit = canEditFeeAmounts(staff.permissions)
  const canSetYear = canEditAcademicYear(staff.permissions)

  const year = parseScheduleYear((await params).year)
  if (year === null) notFound()

  // The schedule needs payments.view; without it the database would return
  // nothing and the page would wrongly say the year has no schedule.
  const schedule = canSeeFeeAmounts(staff.permissions) ? await getFeeSchedule(await createClient(), year) : null

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <Link href="/staff/fees" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
          All years
        </Link>
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Fee schedule {year}</h1>
      </div>

      {schedule === null ? (
        <p className="text-sm text-slate-700">{NOT_SHOWN_WITHOUT_PAYMENTS_VIEW}</p>
      ) : !schedule.ok && schedule.error === "unavailable" ? (
        <Alert variant="destructive">
          <AlertDescription>This fee schedule could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : canEdit ? (
        // One editor whether or not the year has a schedule yet, so the
        // confirmation outlasts the refresh that brings the new schedule in.
        <ScheduleEditor year={year} amounts={schedule.ok ? schedule.data : null}>
          {schedule.ok && <ScheduleView schedule={schedule.data} />}
        </ScheduleEditor>
      ) : schedule.ok ? (
        <ScheduleView schedule={schedule.data} />
      ) : (
        <p className="text-sm text-slate-700">
          No fee schedule for {year} yet.
          {canSetYear && " Once the Accountant creates it, you can set the Academic-year start and seats here."}
        </p>
      )}

      {schedule?.ok && (
        <section aria-labelledby="fees-academic-year" className="flex flex-col gap-4 border-t pt-6">
          <h2 id="fees-academic-year" className="text-base font-semibold text-slate-900">
            Academic year and seats
          </h2>
          {canSetYear ? (
            <AcademicYearEditor year={year} start={schedule.data.academicYearStart} seats={schedule.data.seats}>
              <AcademicYearView schedule={schedule.data} />
            </AcademicYearEditor>
          ) : (
            <AcademicYearView schedule={schedule.data} />
          )}
        </section>
      )}
    </div>
  )
}
