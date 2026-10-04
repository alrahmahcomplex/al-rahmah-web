import { marksAllowed } from "@/lib/services/lead-closure"

import { MarkLead } from "./mark-lead"
import type { LeadPanelProps } from "./panels"

// Mark inactive and Archive, for staff who may close leads. A mark is the one
// change a closed lead still takes, so this panel shows on Declined and
// Inactive leads too, and decides its actions from the lead's mark rather
// than from `open`: both on a lead with no mark, Archive alone on an Inactive
// one, and nothing on an Archived one.
export function ClosureSection({ lead, staff }: LeadPanelProps) {
  const marks = marksAllowed(lead.closure)
  if (marks.length === 0 || !staff.permissions.includes("leads.close")) return null

  return (
    <section aria-labelledby="lead-closure" className="flex flex-col gap-3">
      <h2 id="lead-closure" className="text-sm font-semibold text-slate-900">
        Inactive or Archived
      </h2>
      <div className="flex max-w-xl flex-col gap-3 rounded-xl p-4 ring-1 ring-foreground/10">
        <p className="text-sm text-slate-900">
          {lead.closure === "Inactive"
            ? "This lead is Inactive. If the family is finished for good, archive it. It stays on record."
            : "Mark the lead inactive if the family has gone quiet but may come back, or archive it if they are finished for good. Either way the lead keeps its status and stays on record."}
        </p>
        <div className="flex flex-wrap gap-2">
          {marks.map((mark) => (
            <MarkLead
              key={mark}
              mark={mark}
              lead={{ id: lead.id, studentName: lead.studentName, admissionNumber: lead.admissionNumber, status: lead.status }}
            />
          ))}
        </div>
      </div>
    </section>
  )
}
