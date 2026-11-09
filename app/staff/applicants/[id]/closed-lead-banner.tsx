import type { Lead } from "@/lib/services/leads"

import { closedState } from "./closed-state"
import { ClosedLeadDetails } from "./closure-details"
import { RequestReopeningLink } from "./reopening-section"

// In place of the work actions on a Declined, Inactive or Archived lead: why
// nothing here can be changed, and the way to reopening for staff who may
// raise a reopening request.
export function ClosedLeadBanner({ lead, canRequestReopening }: { lead: Lead; canRequestReopening: boolean }) {
  const title = `This application is ${closedState(lead)}`

  return (
    <section
      aria-label={title}
      className="flex flex-col gap-3 rounded-xl border border-l-4 border-l-slate-400 bg-card p-4 text-sm"
    >
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <ClosedLeadDetails leadId={lead.id} />
      <p className="text-muted-foreground">
        A closed application is read-only. To work on it again, it has to be reopened, and a Manager approves that.
      </p>
      {canRequestReopening && <RequestReopeningLink leadId={lead.id} />}
    </section>
  )
}
