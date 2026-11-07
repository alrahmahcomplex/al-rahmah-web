import Link from "next/link"
import type { ReactNode } from "react"

import { buttonVariants } from "@/components/ui/button"
import { nextStep, nextStepText } from "@/lib/lead-next-step"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"
import type { StaffMember } from "@/lib/services/staff-auth"
import { cn } from "@/lib/utils"

import { readClosure, readFee, readFollowUps, readInterviews, readRegistration, readRelease } from "./lead-reads"
import { LEAD_TABS, leadTabHref, type LeadTab } from "./tabs"

// The one thing that should happen next on an open lead (lib/lead-next-step),
// under the header. Its button takes staff who may do it to the tab where it
// is done; anyone else gets a plain link to that tab, unless it is the tab
// already open. `recordVisit` is Record
// visit, which works in place here: it is passed on every lead the staff
// member may record visits on, so its confirmation outlasts the refresh that
// moves the step on.
export async function NextStepCard({
  lead,
  staff,
  tab,
  recordVisit,
}: {
  lead: Lead
  staff: StaffMember
  // The tab open below the card.
  tab: LeadTab
  recordVisit: ReactNode
}) {
  const canSeeFee = staff.permissions.includes("payments.view")
  const [interviews, registration, closure, release, fee, followUps] = await Promise.all([
    readInterviews(lead.id),
    readRegistration(lead.id),
    readClosure(lead.id),
    readRelease(lead.id),
    canSeeFee ? readFee(lead.id) : null,
    readFollowUps(lead.id),
  ])

  const current = interviews.ok ? (interviews.data[0] ?? null) : null
  const step = interviews.ok
    ? nextStep({
        status: lead.status,
        closure: lead.closure,
        interview: current && { feeStatus: current.feeStatus, amount: current.amount, result: current.result },
        registration: registration.ok ? registration.data : null,
        enrolWithoutRetake: closure.ok && closure.data.reopenedAfterDecline?.enrolWithoutRetake === true,
        release: release.ok
          ? {
              blocked: release.data.blocked,
              sent: release.data.latestRelease !== null,
              changedSinceSent: release.data.changedSinceSent,
            }
          : null,
        fee: fee?.ok && fee.data.kind === "fee" ? { priority: fee.data.priority } : null,
        followUps: followUps.ok
          ? { dueOn: followUps.data.open?.dueOn ?? null, needsDate: followUps.data.needsDate }
          : null,
        today: tanzaniaToday(),
      })
    : null
  if (step?.kind === "closed") return null

  const text = step && nextStepText(step, formatDate)
  const action = text?.action ?? null
  const mayAct = action !== null && staff.permissions.includes(action.permission)
  const link = action !== null && step?.kind !== "record-visit" && (mayAct || action.tab !== tab)

  return (
    <section
      id="lead-next-step"
      // A fixed name, so the step's wording never matches a panel's name.
      aria-label="Next step"
      className={cn(
        "flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-l-4 bg-card px-4 py-3.5",
        action ? "border-l-orange-500" : "border-l-blue-600",
      )}
    >
      <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
        <h2 className="font-semibold text-slate-900">
          {text ? `Next step: ${text.title}` : "Next step"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {text ? text.detail : "The next step could not be worked out. Try again in a moment."}
        </p>
      </div>
      {link && action && (
        <Link
          href={leadTabHref(lead.id, action.tab, action.anchor)}
          className={cn(
            buttonVariants({ variant: mayAct ? "orange" : "outline", size: "lg" }),
            "h-10 px-4",
          )}
        >
          {mayAct ? action.label : `Open ${LEAD_TABS.find((each) => each.key === action.tab)?.label}`}
        </Link>
      )}
      {recordVisit}
    </section>
  )
}
