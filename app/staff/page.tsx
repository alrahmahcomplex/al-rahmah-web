import type { Metadata } from "next"
import { Suspense } from "react"

import { Note, pageTitle } from "@/components/kit"
import { tanzaniaToday } from "@/lib/school-calendar"
import { countPendingDiscountRequests } from "@/lib/services/discounts"
import { getOverdueCount } from "@/lib/services/follow-ups"
import { getHomeChartCounts } from "@/lib/services/home-charts"
import { countInterviewsByDay, countRegistrationsByDay } from "@/lib/services/home-stats"
import { getMyNotices } from "@/lib/services/staff-admin"
import { createClient } from "@/utils/supabase/server"

import { fullClassesFor, mayReadActivity } from "./_home/activity-data"
import { ActivityLog, ActivitySkeleton } from "./_home/activity-log"
import { ChartCard } from "./_home/chart-card"
import { classesTab, monthsTab, sourcesTab, type ChartTab } from "./_home/charts"
import { FindFamily } from "./_home/find-family"
import { Notices } from "./_home/notices"
import { mayCallBack, mayDecideDiscounts, mayOpenSeats, quickActions } from "./_home/quick-action-list"
import { QuickActions } from "./_home/quick-actions"
import { RegisterButton } from "./_home/register-button"
import { namedSeatsTab, needCaption } from "./_home/seats-named"
import { seatsOnOpening } from "./_home/seats-on-opening"
import { StatCard } from "./_home/stat-card"
import { appliedCard, appliedRange, homeDate, interviewCard, interviewRange, pickedDay, pickedWeek } from "./_home/stats"
import { mayRegister } from "./check-in/new/permissions"
import { requireStaff } from "./session"
import "./_home/home.css"

export const metadata: Metadata = {
  title: pageTitle("Home"),
}

const REGISTER_HREF = "/staff/check-in/new"
const DAY_WORDS = { pick: "Open the calendar", choose: "Choose a date", close: "Close", reset: "Back to today" }
const WEEK_WORDS = { pick: "Show another week", choose: "Choose a week", close: "Close", reset: "Back to this week" }

type SearchParams = Promise<Record<string, string | string[] | undefined>>
const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined)

// Home (#323), laid out as prototype v40's bento: the date, the check-in bar
// beside Register students, then the chart card (#405) ending level with the
// two stat cards beside it, and the quick actions as a row of tiles under
// both. The Activity log (#406) takes the full width below, loading on its
// own so the rest of Home never waits for it.
// Every count is read only for someone who may see it today: the
// applications for leads.view, the seats for payments.view, as the
// dashboard shows them.
export default async function HomePage({ searchParams }: { searchParams: SearchParams }) {
  const staff = await requireStaff()
  const supabase = await createClient()
  const permissions = staff.permissions
  const params = await searchParams
  const today = tanzaniaToday()
  const day = pickedDay(one(params.day), today)
  const week = pickedWeek(one(params.week), today)

  const canView = permissions.includes("leads.view")
  const canSeeSeats = permissions.includes("payments.view")
  const canRegister = mayRegister(permissions)
  const interviews = interviewRange(day ?? today)
  const applied = appliedRange(week, today)

  const [notices, interviewCounts, appliedCounts, overdue, seats, discounts, chartCounts] = await Promise.all([
    getMyNotices(supabase),
    canView ? countInterviewsByDay(supabase, interviews.from, interviews.to) : null,
    canView ? countRegistrationsByDay(supabase, applied.from, applied.to) : null,
    mayCallBack(permissions) ? getOverdueCount(supabase) : null,
    canSeeSeats ? seatsOnOpening(supabase, today) : null,
    mayDecideDiscounts(permissions) ? countPendingDiscountRequests(supabase) : null,
    canView ? getHomeChartCounts(supabase, Number(today.slice(0, 4))) : null,
  ])

  const actions = quickActions({
    permissions,
    overdue: overdue?.ok ? overdue.data : null,
    seatsCaption: mayOpenSeats(permissions) && seats?.ok && seats.data.streams ? needCaption(seats.data.streams) : null,
    waitingDiscounts: discounts?.ok ? discounts.data : null,
  })
  const statsFailed =
    (interviewCounts && !interviewCounts.ok) || (appliedCounts && !appliedCounts.ok) || (chartCounts && !chartCounts.ok) || (canSeeSeats && seats && !seats.ok)
  const counts = chartCounts?.ok ? chartCounts.data : null
  // v40 order, Sources first and so the one shown; a tab with nothing to draw is left out.
  const charts = [
    counts && sourcesTab(counts),
    counts && classesTab(counts),
    counts && monthsTab(counts, today),
    canSeeSeats && seats?.ok && seats.data.streams ? namedSeatsTab(seats.data.streams) : null,
  ].filter((tab): tab is ChartTab => !!tab)

  return (
    <div className="hm" data-rise="group">
      {notices.ok ? (
        <Notices notices={notices.data} />
      ) : (
        <Note tone="bad">Recent changes to your account could not be loaded. Try again in a moment.</Note>
      )}
      <h1 className="sr-only">Home</h1>
      <p className="hm-date">{homeDate(today)}</p>
      {(canView || canRegister) && (
        <div className="hm-top">
          {canView ? <FindFamily /> : <span />}
          {canRegister && <RegisterButton href={REGISTER_HREF} />}
        </div>
      )}
      <div className="hm-body">
        <div className="hm-main">{charts.length > 0 && <ChartCard tabs={charts} />}</div>
        <div className="hm-side">
          {interviewCounts?.ok && (
            <StatCard card={interviewCard(day, today, interviewCounts.data)} param="day" today={today} picked={day} words={DAY_WORDS} />
          )}
          {appliedCounts?.ok && (
            <StatCard card={appliedCard(week, today, appliedCounts.data)} param="week" today={today} picked={week} words={WEEK_WORDS} />
          )}
        </div>
      </div>
      {statsFailed && <Note tone="bad">The numbers could not be counted. Try again in a moment.</Note>}
      <QuickActions actions={actions} />
      {mayReadActivity(permissions) && (
        <Suspense fallback={<ActivitySkeleton />}>
          <ActivityLog permissions={permissions} today={today} full={fullClassesFor(permissions, seats?.ok ? seats.data : null)} />
        </Suspense>
      )}
    </div>
  )
}
