import type { ReactNode } from "react"

import type { Lead } from "@/lib/services/leads"

import { CardHeading, LEAD_CARD } from "../lead-card"
import { LeadHeader } from "../lead-header"
import { parentRows, studentRows } from "../lead-rows"
import { Details } from "../lead-summary"

// The lead as read-only cards for the reopening hand-off: the lead record's
// header, the step it offers, then the student and the parent or guardian,
// the same rows the lead page's Overview cards show.
export function LeadSummary({ lead, nextStep }: { lead: Lead; nextStep?: ReactNode }) {
  return (
    <>
      <LeadHeader lead={lead} canViewHistory={false} more={null} />

      {nextStep}

      <div className="lr-grid">
        <section aria-labelledby="lead-student" className={LEAD_CARD}>
          <CardHeading id="lead-student" title="Student" />
          <Details rows={studentRows(lead)} />
        </section>
        <section aria-labelledby="lead-parent" className={LEAD_CARD}>
          <CardHeading id="lead-parent" title="Parent or guardian" />
          <Details rows={parentRows(lead)} />
        </section>
      </div>
    </>
  )
}
