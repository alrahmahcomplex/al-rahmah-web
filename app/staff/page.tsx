import type { Metadata } from "next"

import { ButtonLink, Note, PageHeader, pageTitle } from "@/components/kit"
import { formatLongDate, tanzaniaHour, tanzaniaToday } from "@/lib/school-calendar"
import { countPendingDiscountRequests } from "@/lib/services/discounts"
import { getFollowUpQueue } from "@/lib/services/follow-ups"
import { getPendingAgentCount } from "@/lib/services/marketing-agents"
import { countUnreviewedReApplications } from "@/lib/services/re-applications"
import { countPendingReopeningRequests } from "@/lib/services/reopening-requests"
import { getMyNotices } from "@/lib/services/staff-admin"
import { countResultsReadyToSend, listInterviewsOn, listLatestLeads } from "@/lib/services/today"
import { createClient } from "@/utils/supabase/server"

import { firstName, greeting } from "./_today/greeting"
import { LatestRegistrations } from "./_today/latest-registrations"
import { NeedsYou } from "./_today/needs-you"
import { Notices } from "./_today/notices"
import { mayActOn, queueRows, summaryLine, type QueueRowKey } from "./_today/queue"
import { requireStaff } from "./session"

import "./_today/today.css"

export const metadata: Metadata = {
  title: pageTitle("Today"),
}

// The staff home (#226): a greeting, the two front-desk actions, the work
// waiting for this staff member, and the newest leads. Each count is read
// only for someone who may act on it, through the same services as the
// sidebar's counts. The statistics live on the Reports page. Drawn in the
// new shell (#323), in the prototype's narrow centred column.
export default async function TodayPage() {
  const staff = await requireStaff()
  const supabase = await createClient()
  const permissions = staff.permissions
  const may = (key: QueueRowKey) => mayActOn(key, permissions)
  const canView = permissions.includes("leads.view")
  const canRegister = permissions.includes("leads.create") && permissions.includes("visits.record")
  const today = tanzaniaToday()

  const [notices, overdue, interviews, reApplications, results, agents, discounts, reopenings, latest] = await Promise.all([
    getMyNotices(supabase),
    may("overdue") ? getFollowUpQueue(supabase, { section: "overdue", page: 1 }) : null,
    may("interviews") ? listInterviewsOn(supabase, today) : null,
    may("reApplications") ? countUnreviewedReApplications(supabase) : null,
    may("results") ? countResultsReadyToSend(supabase) : null,
    may("agents") ? getPendingAgentCount(supabase) : null,
    may("discounts") ? countPendingDiscountRequests(supabase) : null,
    may("reopenings") ? countPendingReopeningRequests(supabase) : null,
    canView ? listLatestLeads(supabase) : null,
  ])

  const oldest = overdue?.ok ? overdue.data.items[0] : undefined
  const rows = queueRows({
    overdue: overdue?.ok
      ? { count: overdue.data.total, oldest: oldest ? { kind: oldest.kind, studentName: oldest.lead.studentName, dueOn: oldest.dueOn } : null }
      : undefined,
    interviews: interviews?.ok ? interviews.data : undefined,
    reApplications: reApplications?.ok ? { count: reApplications.data } : undefined,
    results: results?.ok ? results.data : undefined,
    agents: agents?.ok ? { count: agents.data } : undefined,
    discounts: discounts?.ok ? { count: discounts.data } : undefined,
    reopenings: reopenings?.ok ? { count: reopenings.data } : undefined,
  })
  const unavailable = [overdue, interviews, reApplications, results, agents, discounts, reopenings].some((read) => read !== null && !read.ok)
  const summary = summaryLine(rows)

  return (
    <div className="td-narrow" data-rise="group">
      <PageHeader
        title={`${greeting(tanzaniaHour())}, ${firstName(staff.name)}`}
        subtitle={
          <span data-testid="today-summary">
            {formatLongDate(today)}
            {summary && ` · ${summary}`}
          </span>
        }
        actions={
          (canView || canRegister) && (
            <>
              {canView && (
                <ButtonLink href="/staff/check-in" icon="checkin">
                  Check in a family
                </ButtonLink>
              )}
              {canRegister && (
                <ButtonLink href="/staff/check-in/new" variant="ghost" icon="register">
                  Register a student
                </ButtonLink>
              )}
            </>
          )
        }
      />

      {notices.ok ? (
        <Notices notices={notices.data} />
      ) : (
        <Note tone="bad">Recent changes to your account could not be loaded. Try again in a moment.</Note>
      )}

      <NeedsYou rows={rows} unavailable={unavailable} />
      {latest && <LatestRegistrations leads={latest} />}
    </div>
  )
}
