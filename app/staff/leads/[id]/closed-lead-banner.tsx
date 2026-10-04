import type { Lead } from "@/lib/services/leads"

import { closedState } from "./closed-state"
import { ClosedLeadDetails } from "./closure-details"
import { RequestReopeningLink } from "./reopening-section"

// In place of the work actions on a Declined, Inactive or Archived lead: why
// nothing here can be changed, and the way to reopening for staff who may
// raise a reopening request.
export function ClosedLeadBanner({ lead, canRequestReopening }: { lead: Lead; canRequestReopening: boolean }) {
  const title = `This lead is ${closedState(lead)}`

  return (
    <section
      aria-label={title}
      className="flex max-w-xl flex-col gap-3 rounded-lg border bg-card p-4 text-sm"
    >
      <h2 className="font-semibold text-slate-900">{title}</h2>
      <ClosedLeadDetails leadId={lead.id} />
      <p className="text-muted-foreground">
        A closed lead is read-only. To work on it again, it has to be reopened, and a Manager approves that.
      </p>
      {canRequestReopening && <RequestReopeningLink leadId={lead.id} />}
    </section>
  )
}
