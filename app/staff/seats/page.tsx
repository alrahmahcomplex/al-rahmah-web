import type { Metadata } from "next"

import { Note, PageHeader, pageTitle, Tabs } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import { listFeeSchedules } from "@/lib/services/fees"
import { getYearStreamChildren, getYearStreams } from "@/lib/services/streams"
import { createClient } from "@/utils/supabase/server"

import { parseScheduleYear } from "../fees/years"
import StaffForbidden from "../forbidden"
import { requireStaff } from "../session"
import { defaultSeatsYear } from "./format"
import { StreamsView } from "./streams-view"

import "./seats.css"

export const metadata: Metadata = {
  title: pageTitle("Seats"),
}

const yearHref = (year: number) => `/staff/seats?year=${year}`

// The streams of a year (#449): their seats, the children placed in them
// and the children waiting for one, for staff who can view payments; only
// staff who manage academic years change them. Drawn in the new shell (#329).
export default async function SeatsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("payments.view")) return <StaffForbidden />
  const supabase = await createClient()
  const schedules = await listFeeSchedules(supabase)
  const years = schedules.ok ? schedules.data.map((schedule) => schedule.year).toSorted((a, b) => a - b) : []
  const { year: requested } = await searchParams
  const year = requested === undefined ? defaultSeatsYear(years, tanzaniaToday()) : parseScheduleYear(requested)
  const manages = staff.permissions.includes("academic_years.manage")
  const [streams, previous, children] =
    year === null
      ? [null, null, null]
      : await Promise.all([
          getYearStreams(supabase, year),
          years.includes(year - 1) ? getYearStreams(supabase, year - 1) : null,
          // The Change sheet shows who would move where, so only the Manager reads the children placed.
          manages ? getYearStreamChildren(supabase, year) : null,
        ])
  const tabs =
    years.length > 0 ? (
      <Tabs
        label="Enrollment years"
        tabs={years.map((each) => ({ label: String(each), href: yearHref(each) }))}
        current={year === null ? null : yearHref(year)}
      />
    ) : null

  if (!schedules.ok || (streams !== null && !streams.ok) || (children !== null && !children.ok)) {
    return (
      <>
        <PageHeader title="Seats" />
        <div className="st-stack">
          {tabs}
          <Note tone="bad" role="alert">
            The seats could not be loaded. Try again in a moment.
          </Note>
        </div>
      </>
    )
  }
  if (year === null || streams === null) {
    return (
      <>
        <PageHeader title="Seats" />
        <div className="st-stack">
          {tabs}
          <p className="st-text">
            {requested === undefined ? "No fee schedule has been set up yet, so there are no seats to count." : "Choose a year from 2000 to 2999."}
          </p>
        </div>
      </>
    )
  }
  return (
    <StreamsView
      data={streams.data}
      previous={previous?.ok ? previous.data : null}
      who={{ manages, mayDecline: manages && staff.permissions.includes("leads.decline") }}
      tabs={tabs}
      placed={children?.ok ? children.data : []}
    />
  )
}
