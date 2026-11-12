import type { Metadata } from "next"
import { forbidden, redirect } from "next/navigation"

import { Button, Card, EmptyState, Field, FieldError, ListRow, Note, PageHeader, pageTitle } from "@/components/kit"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { listFeeSchedules } from "@/lib/services/fees"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { formatShillings } from "./format"
import {
  canEditFeeAmounts,
  canReadFeeSchedule,
  canSeeFeeAmounts,
  NOT_SHOWN_WITHOUT_PAYMENTS_VIEW,
  parseScheduleYear,
} from "./years"

import "./fees.css"

export const metadata: Metadata = {
  title: pageTitle("Fee schedule"),
}

// Every enrollment year with a Fee schedule, and New schedule for staff who
// may set the amounts. Drawn in the new shell (#329).
export default async function FeeSchedulesPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const staff = await requireStaff()
  if (!canReadFeeSchedule(staff.permissions)) forbidden()
  const canEdit = canEditFeeAmounts(staff.permissions)

  // The New schedule form asks for a year, then opens that year's page.
  const { year: requested } = await searchParams
  const newYear = requested === undefined ? null : parseScheduleYear(requested)
  if (newYear !== null) redirect(`/staff/fees/${newYear}`)

  if (!canSeeFeeAmounts(staff.permissions)) {
    return (
      <>
        <PageHeader title="Fee schedule" />
        <p className="fs-text">{NOT_SHOWN_WITHOUT_PAYMENTS_VIEW}</p>
      </>
    )
  }

  const schedules = await listFeeSchedules(await createClient())
  const nextYear = Number(tanzaniaToday().slice(0, 4)) + 1
  const yearRefused = requested !== undefined && newYear === null

  return (
    <>
      <PageHeader title="Fee schedule" />
      <div className="fs-stack">
        {!schedules.ok ? (
          <Note tone="bad" role="alert">
            The fee schedules could not be loaded. Try again in a moment.
          </Note>
        ) : schedules.data.length === 0 ? (
          <Card>
            <EmptyState title="No fee schedule has been set up yet." />
          </Card>
        ) : (
          <Card>
            <ul aria-label="Enrollment years" className="fs-list">
              {schedules.data.map((schedule) => (
                <li key={schedule.year}>
                  <ListRow
                    href={`/staff/fees/${schedule.year}`}
                    title={schedule.year}
                    caption={
                      <>
                        Instalments {schedule.split.first} / {schedule.split.second} / {schedule.split.third}%, first due{" "}
                        {formatDate(schedule.dueDates.first)} · Minimum deposit TZS {formatShillings(schedule.minimumDeposit)}
                      </>
                    }
                  />
                </li>
              ))}
            </ul>
          </Card>
        )}

        {canEdit && (
          <Card title="New schedule" titleId="fees-new-schedule">
            <form action="/staff/fees" aria-label="New schedule" className="fs-card-body">
              <label htmlFor="new-schedule-year" className="fs-label">
                Enrollment year
              </label>
              <div className="fs-year-row">
                <Field
                  id="new-schedule-year"
                  name="year"
                  size="compact"
                  inputMode="numeric"
                  required
                  pattern="\d{4}"
                  defaultValue={String(nextYear)}
                  className="fs-money"
                  invalid={yearRefused}
                  aria-describedby="new-schedule-year-error"
                />
                <Button type="submit" variant="ghost" size="small">
                  Open year
                </Button>
              </div>
              <FieldError id="new-schedule-year-error" alignStart message={yearRefused ? "Enter a year from 2000 to 2999." : undefined} />
            </form>
          </Card>
        )}
      </div>
    </>
  )
}
