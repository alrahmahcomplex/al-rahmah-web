import type { Metadata } from "next"
import Link from "next/link"
import { forbidden, notFound } from "next/navigation"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { getFeeSchedule } from "@/lib/services/fees"
import { createClient } from "@/utils/supabase/server"

import { requireStaff } from "../../session"
import { ScheduleEditor } from "../schedule-editor"
import { ScheduleView } from "../schedule-view"
import { canReadFeeSchedule, canSeeFeeAmounts, parseScheduleYear } from "../years"

export const metadata: Metadata = {
  title: "Fee schedule · Al-Rahmah Complex",
}

// One enrollment year's Fee schedule: editable for staff who may record
// payments, read-only for everyone else who may open it.
export default async function FeeSchedulePage({ params }: { params: Promise<{ year: string }> }) {
  const staff = await requireStaff()
  if (!canReadFeeSchedule(staff.permissions)) forbidden()
  const canEdit = staff.permissions.includes("payments.record")

  const year = parseScheduleYear((await params).year)
  if (year === null) notFound()

  // Amounts need payments.view; without it the database would return nothing
  // and the page would wrongly say the year has no schedule.
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
        <p className="text-sm text-slate-700">Fee amounts are shown only to staff who can view payments.</p>
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
        <p className="text-sm text-slate-700">No fee schedule for {year} yet.</p>
      )}
    </div>
  )
}
