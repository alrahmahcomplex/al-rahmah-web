import Link from "next/link"

import { Note, Tag } from "@/components/kit"
import { getLeadReApplications } from "@/lib/services/re-applications"
import { createClient } from "@/utils/supabase/server"

import { differingText, when } from "../../re-applications/format"
import type { LeadPanelProps } from "./panels"

// Every Re-application on the lead, newest first, reviewed or not, so the
// lead shows how often the family has applied. Each opens the re-application,
// where staff who may edit leads mark it reviewed. A lead nobody re-applied
// for shows nothing.
export async function ReApplicationSection({ lead }: LeadPanelProps) {
  const reApplications = await getLeadReApplications(await createClient(), lead.id)
  if (reApplications.ok && reApplications.data.length === 0) return null

  return (
    <section aria-labelledby="lead-re-applications" className="lr-card">
      <h2 id="lead-re-applications" className="kit-card-title">
        Re-applications
      </h2>
      {!reApplications.ok ? (
        <Note tone="bad">The re-applications could not be loaded. Try again in a moment.</Note>
      ) : (
        <ul className="lr-list">
          {reApplications.data.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <Link href={`/staff/re-applications/${entry.id}`} className="lr-link">
                <time dateTime={entry.receivedAt}>{when(entry.receivedAt)}</time>
              </Link>
              <span className="lr-quiet">{differingText(entry.differingFields.length)}</span>
              {entry.reviewedAt ? (
                <span className="lr-quiet">Reviewed by {entry.reviewedBy ?? "Unknown"}</span>
              ) : (
                <Tag tone="wait">Not reviewed</Tag>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
