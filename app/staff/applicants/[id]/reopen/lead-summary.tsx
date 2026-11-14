import type { ReactNode } from "react"

import { StatusChip } from "@/components/status-chip"
import { Badge } from "@/components/ui/badge"
import type { Lead } from "@/lib/services/leads"

import { parentRows, studentRows } from "../lead-rows"

// The lead as read-only fields: the student, the parent or guardian, and where
// the lead stands, for the reopening hand-off, with the step it offers under
// the heading. The lead page shows the same rows in its Overview cards.
export function LeadSummary({ lead, nextStep }: { lead: Lead; nextStep?: ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="staff-heading">{lead.studentName}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-lg font-semibold text-slate-900" aria-label="Admission Number">
            {lead.admissionNumber}
          </p>
          <StatusChip status={lead.status} />
          {lead.closure && <StatusChip status={lead.closure} />}
          {lead.initiallyDeclined && <Badge variant="outline">Initially declined</Badge>}
          {lead.returningFamily && <Badge variant="outline">Returning family</Badge>}
        </div>
      </div>

      {nextStep}

      <section aria-labelledby="lead-student" className="flex flex-col gap-2">
        <h2 id="lead-student" className="staff-section-heading">
          Student
        </h2>
        <Details rows={studentRows(lead)} />
      </section>

      <section aria-labelledby="lead-parent" className="flex flex-col gap-2">
        <h2 id="lead-parent" className="staff-section-heading">
          Parent or guardian
        </h2>
        <Details rows={parentRows(lead)} />
      </section>
    </div>
  )
}

function Details({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="grid max-w-xl grid-cols-[minmax(0,10rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {rows.map(([term, value]) => (
        <div key={term} className="contents">
          <dt className="text-muted-foreground">{term}</dt>
          <dd className="break-words text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  )
}
