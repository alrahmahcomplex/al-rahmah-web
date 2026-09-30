import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { formatDate } from "@/lib/school-calendar"
import type { Lead } from "@/lib/services/leads"

// The lead as read-only fields: the student, the parent or guardian, and where
// the lead stands. Used by the lead screen and the reopening hand-off. The
// lead screen wraps a section's fields to offer corrections to them.
export function LeadSummary({
  lead,
  student = (fields) => fields,
  parent = (fields) => fields,
}: {
  lead: Lead
  student?: (fields: ReactNode) => ReactNode
  parent?: (fields: ReactNode) => ReactNode
}) {
  const relationship =
    lead.contact.relationship === "Other" && lead.contact.relationshipDescription
      ? `Other: ${lead.contact.relationshipDescription}`
      : lead.contact.relationship

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">{lead.studentName}</h1>
        <div className="flex flex-wrap items-center gap-2">
          <p className="font-mono text-lg font-semibold text-slate-900" aria-label="Admission Number">
            {lead.admissionNumber}
          </p>
          <Badge variant="secondary">{lead.status}</Badge>
          {lead.closure && <Badge variant="outline">{lead.closure}</Badge>}
          {lead.returningFamily && <Badge variant="outline">Returning family</Badge>}
        </div>
      </div>

      <section aria-labelledby="lead-student" className="flex flex-col gap-2">
        <h2 id="lead-student" className="text-sm font-semibold text-slate-900">
          Student
        </h2>
        {student(
          <Details
            rows={[
              ["Class", lead.className],
              ["Enrollment year", String(lead.enrollmentYear)],
              ["Day or boarding", lead.dayOrBoarding],
              ["Status", lead.status],
              ["Visit date", lead.visitDate ? formatDate(lead.visitDate) : "Not visited yet"],
            ]}
          />,
        )}
      </section>

      <section aria-labelledby="lead-parent" className="flex flex-col gap-2">
        <h2 id="lead-parent" className="text-sm font-semibold text-slate-900">
          Parent or guardian
        </h2>
        {parent(
          <Details
            rows={[
              ["Full name", lead.contact.fullName],
              ["Relationship", relationship],
              ["Phone", lead.contact.phone],
              ["WhatsApp", lead.contact.whatsapp ?? "Same as phone"],
            ]}
          />,
        )}
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
