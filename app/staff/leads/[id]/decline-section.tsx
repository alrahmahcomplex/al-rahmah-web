import { declinedReasonsFor } from "@/lib/services/lead-closure"

import { DeclineLead } from "./decline-lead"
import type { LeadPanelProps } from "./panels"

// Decline, for staff who may decline leads, on an open lead only: a closed
// lead is read-only, and the page leaves this panel off it.
export function DeclineSection({ lead, staff, open }: LeadPanelProps) {
  if (!open || !staff.permissions.includes("leads.decline")) return null

  return (
    <section aria-labelledby="lead-decline" className="flex flex-col gap-3">
      <h2 id="lead-decline" className="text-sm font-semibold text-slate-900">
        Decline
      </h2>
      <div className="flex max-w-xl flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
        <p className="text-sm text-slate-900">
          If the family or the school won&apos;t go ahead, decline the lead with a reason. A declined lead is read-only
          until a Manager approves reopening it.
        </p>
        <div>
          <DeclineLead
            lead={{ id: lead.id, studentName: lead.studentName, admissionNumber: lead.admissionNumber, status: lead.status }}
            reasons={declinedReasonsFor(staff.permissions)}
          />
        </div>
      </div>
    </section>
  )
}
