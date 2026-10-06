import Link from "next/link"

import { Alert, AlertDescription } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
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
    <section aria-labelledby="lead-re-applications" className="flex flex-col gap-3">
      <h2 id="lead-re-applications" className="text-sm font-semibold text-slate-900">
        Re-applications
      </h2>
      {!reApplications.ok ? (
        <Alert variant="destructive" className="max-w-xl">
          <AlertDescription>The re-applications could not be loaded. Try again in a moment.</AlertDescription>
        </Alert>
      ) : (
        <ul className="flex max-w-xl flex-col divide-y rounded-xl text-sm ring-1 ring-foreground/10">
          {reApplications.data.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-3">
              <Link
                href={`/staff/re-applications/${entry.id}`}
                className="font-medium text-blue-600 underline-offset-4 hover:underline"
              >
                <time dateTime={entry.receivedAt}>{when(entry.receivedAt)}</time>
              </Link>
              <span className="text-muted-foreground">{differingText(entry.differingFields.length)}</span>
              {entry.reviewedAt ? (
                <span className="text-muted-foreground">Reviewed by {entry.reviewedBy ?? "Unknown"}</span>
              ) : (
                <Badge variant="outline" className="border-amber-300 bg-amber-50 text-amber-900">
                  Not reviewed
                </Badge>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
