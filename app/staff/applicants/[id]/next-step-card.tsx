import { ButtonLink } from "@/components/kit"
import { enrolsWithoutRetake, nextStep, nextStepText, releaseInput } from "@/lib/lead-next-step"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"
import type { StaffMember } from "@/lib/services/staff-auth"

import { LEAD_CARD } from "./lead-card"
import { readFee, readFollowUps, readInterviews, readRegistration, readRelease, readReleaseStatus, readReopenings } from "./lead-reads"
import { RecordVisit } from "./record-visit"
import { LEAD_TABS, leadTabHref, type LeadTab } from "./tabs"

// The one thing that should happen next on an open lead (lib/lead-next-step),
// under the header. Its button takes staff who may do it to the tab where it
// is done; anyone else gets a plain link to that tab, unless it is the tab
// already open. Record visit works in place here.
export async function NextStepCard({
  lead,
  staff,
  tab,
}: {
  lead: Lead
  staff: StaffMember
  // The tab open below the card.
  tab: LeadTab
}) {
  const canSeeFee = staff.permissions.includes("payments.view")
  const [interviews, registration, reopenings, release, fee, followUps] = await Promise.all([
    readInterviews(lead.id),
    readRegistration(lead.id),
    readReopenings(lead.id),
    readRelease(lead.id),
    canSeeFee ? readFee(lead.id) : null,
    readFollowUps(lead.id),
  ])

  // Once a result has gone, whether it changed since comes from the status
  // every viewer reads, not only those who may send it (#248).
  const sentFor = release.ok && release.data.latestRelease !== null ? release.data.interviewId : null
  const status = sentFor ? await readReleaseStatus(sentFor) : null
  const current = interviews.ok ? (interviews.data[0] ?? null) : null
  const step = interviews.ok
    ? nextStep({
        status: lead.status,
        closure: lead.closure,
        interview: current && { feeStatus: current.feeStatus, amount: current.amount, result: current.result },
        registration: registration.ok ? registration.data : null,
        enrolWithoutRetake: reopenings.ok && enrolsWithoutRetake(reopenings.data.decided),
        release: release.ok
          ? releaseInput(release.data, status?.ok && sentFor ? (status.data.get(sentFor) ?? null) : null)
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
      className={`${LEAD_CARD} lr-step`}
    >
      <div>
        <h2 className="kit-card-title">{text ? `Next step: ${text.title}` : "Next step"}</h2>
        <p className="kit-card-cap">
          {text ? text.detail : "The next step could not be worked out. Try again in a moment."}
        </p>
      </div>
      {link && action && (
        <ButtonLink
          href={leadTabHref(lead.id, action.tab, action.anchor)}
          variant={mayAct ? "go" : "ghost"}
          chevron={mayAct}
        >
          {mayAct ? action.label : `Open ${LEAD_TABS.find((each) => each.key === action.tab)?.label}`}
        </ButtonLink>
      )}
      {staff.permissions.includes("visits.record") && (
        // Mounted for everyone who may record visits, so its confirmation
        // outlasts the refresh that moves the step on. It offers its button
        // as the step's own action while Record visit is the step, and as a
        // secondary one on any other open Applied lead (#249).
        <RecordVisit
          key={lead.id}
          leadId={lead.id}
          offer={
            step?.kind === "record-visit"
              ? "step"
              : lead.status === "Applied" && lead.closure === null
                ? "secondary"
                : null
          }
        />
      )}
    </section>
  )
}
