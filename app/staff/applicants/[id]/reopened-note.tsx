import { getLeadClosure } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

import type { LeadPanelProps } from "./panels"
import { retakeChoiceText } from "./reopening-decision-outcome"
import { dayOf } from "./reopening-outcome"

// The Reopened after decline note (#101), on a lead an approval brought back
// from Declined: when, by whom, and the retake choice when it applied. A lead
// never reopened from Declined shows nothing. Read-only, so it stays on a lead
// declined again.
export async function ReopenedNote({ lead }: LeadPanelProps) {
  if (!lead.initiallyDeclined) return null
  const closure = await getLeadClosure(await createClient(), lead.id)
  if (!closure.ok || !closure.data.reopenedAfterDecline) return null

  const { reopenedAt, approvedBy, enrolWithoutRetake } = closure.data.reopenedAfterDecline
  const retake = retakeChoiceText(enrolWithoutRetake)
  return (
    <section aria-label="Reopened after decline" className="flex max-w-xl flex-col gap-1 rounded-lg border bg-card p-4 text-sm">
      <h2 className="font-semibold text-slate-900">Reopened after decline</h2>
      <p className="text-slate-900">
        Approved by {approvedBy} on {dayOf(reopenedAt)}.{retake && ` ${retake}.`}
      </p>
    </section>
  )
}
