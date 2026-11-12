import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Card, Note, PageHeader, pageTitle } from "@/components/kit"
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

import "../fees.css"

export const metadata: Metadata = {
  title: pageTitle("Fee schedule"),
}

// One enrollment year's Fee schedule. The amounts are editable for staff who
// may record payments, the Academic-year start and seats for staff who manage
// academic years, and everything is read-only for everyone else who may open it.
// Drawn in the new shell (#329).
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
    <>
      <Link href="/staff/fees" className="kit-link fs-back">
        All years
      </Link>
      <PageHeader title={`Fee schedule ${year}`} />

      <div className="fs-stack">
        {schedule === null ? (
          <p className="fs-text">{NOT_SHOWN_WITHOUT_PAYMENTS_VIEW}</p>
        ) : !schedule.ok && schedule.error === "unavailable" ? (
          <Note tone="bad" role="alert">
            This fee schedule could not be loaded. Try again in a moment.
          </Note>
        ) : canEdit ? (
          // One editor whether or not the year has a schedule yet, so the
          // confirmation outlasts the refresh that brings the new schedule in.
          <ScheduleEditor year={year} amounts={schedule.ok ? schedule.data : null}>
            {schedule.ok && <ScheduleView schedule={schedule.data} />}
          </ScheduleEditor>
        ) : schedule.ok ? (
          <ScheduleView schedule={schedule.data} />
        ) : (
          <p className="fs-text">
            No fee schedule for {year} yet.
            {canSetYear && " Once the Accountant creates it, you can set the Academic-year start and seats here."}
          </p>
        )}

        {schedule?.ok && (
          <Card title="Academic year and seats" titleId="fees-academic-year">
            <div className="fs-card-body">
              {canSetYear ? (
                <AcademicYearEditor year={year} start={schedule.data.academicYearStart} seats={schedule.data.seats}>
                  <AcademicYearView schedule={schedule.data} />
                </AcademicYearEditor>
              ) : (
                <AcademicYearView schedule={schedule.data} />
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  )
}
