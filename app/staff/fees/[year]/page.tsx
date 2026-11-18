import type { Metadata } from "next"
import Link from "next/link"

import { Card, Note, PageHeader, pageTitle } from "@/components/kit"
import { getFeeSchedule } from "@/lib/services/fees"
import { getSeatMode } from "@/lib/services/streams"
import { createClient } from "@/utils/supabase/server"

import StaffForbidden from "../../forbidden"
import StaffNotFound from "../../not-found"
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
  if (!canReadFeeSchedule(staff.permissions)) return <StaffForbidden />
  const canEdit = canEditFeeAmounts(staff.permissions)
  const canSetYear = canEditAcademicYear(staff.permissions)

  const year = parseScheduleYear((await params).year)
  if (year === null) return <StaffNotFound />

  // The schedule needs payments.view; without it the database would return
  // nothing and the page would wrongly say the year has no schedule.
  const supabase = await createClient()
  const [schedule, mode] = await Promise.all([
    canSeeFeeAmounts(staff.permissions) ? getFeeSchedule(supabase, year) : null,
    getSeatMode(supabase),
  ])
  // Once streams are on (#449), seats are set on the Seats screen, not here.
  const streamsOn = mode === "named"

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
            {canSetYear && ` Once the Accountant creates it, you can set the Academic-year start${streamsOn ? "" : " and seats"} here.`}
          </p>
        )}

        {schedule?.ok && (
          <Card title={streamsOn ? "Academic year" : "Academic year and seats"} titleId="fees-academic-year">
            <div className="fs-card-body">
              {canSetYear ? (
                <AcademicYearEditor year={year} start={schedule.data.academicYearStart} seats={schedule.data.seats} streamsOn={streamsOn}>
                  <AcademicYearView schedule={schedule.data} streamsOn={streamsOn} />
                </AcademicYearEditor>
              ) : (
                <AcademicYearView schedule={schedule.data} streamsOn={streamsOn} />
              )}
            </div>
          </Card>
        )}
      </div>
    </>
  )
}
