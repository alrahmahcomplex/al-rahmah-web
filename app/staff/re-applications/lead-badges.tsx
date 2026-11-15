import { StatusChip } from "@/components/kit"
import type { LeadClosure, LeadStatus } from "@/lib/services/leads"

import "./re-applications.css"

// The lead's status and closure mark, as the Applicants list shows them.
export function LeadBadges({ status, closure }: { status: LeadStatus; closure: LeadClosure | null }) {
  return (
    <span className="ra-chips">
      <StatusChip status={status} />
      {closure && <StatusChip status={closure} />}
    </span>
  )
}
