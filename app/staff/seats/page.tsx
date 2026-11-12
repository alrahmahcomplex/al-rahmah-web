import type { Metadata } from "next"
import { forbidden } from "next/navigation"

import { Card, Note, PageHeader, pageTitle } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import { listFeeSchedules } from "@/lib/services/fees"
import { getSeats } from "@/lib/services/seats"
import { createClient } from "@/utils/supabase/server"

import { parseScheduleYear } from "../fees/years"
import { requireStaff } from "../session"
import { defaultSeatsYear } from "./format"
import { RankedClass } from "./ranked-class"
import { SeatsTable } from "./seats-table"
import { YearTabs } from "./year-tabs"

import "./seats.css"

export const metadata: Metadata = {
  title: pageTitle("Seats"),
}

const yearHref = (year: number) => `/staff/seats?year=${year}`

// How full each class is in a year, and, for each class with more leads
// holding a Seat priority than seats, its leads ranked so the Admissions
// Manager can decide who keeps a place. For staff who manage academic years;
// the counts sit behind payments.view in the database. Drawn in the new
// shell (#329).
export default async function SeatsPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const staff = await requireStaff()
  if (!staff.permissions.includes("academic_years.manage")) forbidden()

  if (!staff.permissions.includes("payments.view")) {
    return (
      <>
        <PageHeader title="Seats" />
        <p className="st-text">Seats are shown only to staff who can view payments.</p>
      </>
    )
  }

  const supabase = await createClient()
  const schedules = await listFeeSchedules(supabase)
  const years = schedules.ok ? schedules.data.map((schedule) => schedule.year).toSorted((a, b) => a - b) : []
  const { year: requested } = await searchParams
  const year = requested === undefined ? defaultSeatsYear(years, tanzaniaToday()) : parseScheduleYear(requested)
  const seats = year === null ? null : await getSeats(supabase, year)
  const overFull = seats?.ok ? seats.data.filter((entry) => entry.ranked !== null) : []

  return (
    <>
      <PageHeader title={`Seats${year !== null ? ` ${year}` : ""}`} />
      <div className="st-stack">
        {years.length > 0 && (
          <YearTabs
            label="Enrollment years"
            tabs={years.map((each) => ({ label: String(each), href: yearHref(each) }))}
            current={year === null ? null : yearHref(year)}
          />
        )}

        {!schedules.ok || (seats !== null && !seats.ok) ? (
          <Note tone="bad" role="alert">
            The seats could not be loaded. Try again in a moment.
          </Note>
        ) : year === null ? (
          <p className="st-text">
            {requested === undefined ? "No fee schedule has been set up yet, so there are no seats to count." : "Choose a year from 2000 to 2999."}
          </p>
        ) : (
          seats?.ok && (
            <>
              {overFull.length > 0 && (
                <Card title="Over capacity" titleId="seats-over-capacity">
                  {overFull.map((entry) => (
                    <RankedClass
                      key={`${entry.className}-${entry.dayOrBoarding}`}
                      entry={entry}
                      canDecline={staff.permissions.includes("leads.decline")}
                    />
                  ))}
                </Card>
              )}

              <Card
                title="Seats by class"
                titleId="seats-by-class"
                caption="An applicant takes a seat once they have a Seat priority. Declined applicants take none; Inactive and Archived applicants keep theirs."
              >
                <div className="st-body">
                  <SeatsTable rows={seats.data} />
                </div>
              </Card>
            </>
          )
        )}
      </div>
    </>
  )
}
