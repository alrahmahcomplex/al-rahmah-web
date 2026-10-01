import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, redirect } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { listFeeSchedules } from "@/lib/services/fees"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../session"
import { formatShillings } from "./format"
import { canReadFeeSchedule, canSeeFeeAmounts, parseScheduleYear } from "./years"

export const metadata: Metadata = {
  title: "Fee schedule · Al-Rahmah Complex",
}

export default async function FeeSchedulesPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const staff = await requireStaff()
  if (!canReadFeeSchedule(staff.permissions)) forbidden()
  const canEdit = staff.permissions.includes("payments.record")

  // The New schedule form asks for a year, then opens that year's page.
  const { year: requested } = await searchParams
  const newYear = requested === undefined ? null : parseScheduleYear(requested)
  if (newYear !== null) redirect(`/staff/fees/${newYear}`)

  if (!canSeeFeeAmounts(staff.permissions)) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Fee schedule</h1>
        <p className="text-sm text-slate-700">Fee amounts are shown only to staff who can view payments.</p>
      </div>
    )
  }

  const schedules = await listFeeSchedules(await createClient())
  const nextYear = Number(tanzaniaToday().slice(0, 4)) + 1

  return (
    <div className="flex flex-col gap-6">
      <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">Fee schedule</h1>

      {!schedules.ok ? (
        <Alert variant="destructive">
          <AlertDescription>The fee schedules could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : schedules.data.length === 0 ? (
        <p className="text-sm text-slate-700">No fee schedule has been set up yet.</p>
      ) : (
        <ul aria-label="Enrollment years" className="flex flex-col divide-y rounded-xl ring-1 ring-foreground/10">
          {schedules.data.map((schedule) => (
            <li key={schedule.year}>
              <Link
                href={`/staff/fees/${schedule.year}`}
                className="flex flex-col gap-0.5 px-4 py-3 hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
              >
                <span className="font-semibold text-slate-900">{schedule.year}</span>
                <span className="text-sm text-muted-foreground">
                  Instalments {schedule.split.first} / {schedule.split.second} / {schedule.split.third}%, first due{" "}
                  {formatDate(schedule.dueDates.first)} · Minimum deposit TZS {formatShillings(schedule.minimumDeposit)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form action="/staff/fees" className="flex max-w-sm flex-col gap-2" aria-label="New schedule">
          <h2 className="text-sm font-semibold text-slate-900">New schedule</h2>
          <Label htmlFor="new-schedule-year">Enrollment year</Label>
          <div className="flex gap-2">
            <Input
              id="new-schedule-year"
              name="year"
              inputMode="numeric"
              required
              pattern="\d{4}"
              defaultValue={String(nextYear)}
              className="w-28"
            />
            <Button type="submit" variant="outline">
              Open year
            </Button>
          </div>
          {requested !== undefined && newYear === null && (
            <p role="alert" className="text-sm text-destructive">
              Enter a year from 2000 to 2999.
            </p>
          )}
        </form>
      )}
    </div>
  )
}
