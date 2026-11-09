import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadClosure, type LeadClosureMark } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

import { DeclineFacts } from "./decline-details"

// Why a closed lead is closed, on its banner: the decline, the closure mark,
// or both, each under its own heading when the lead carries both.
export async function ClosedLeadDetails({ leadId }: { leadId: string }) {
  const closure = await getLeadClosure(await createClient(), leadId)
  if (!closure.ok) {
    return <p className="text-muted-foreground">Why this lead is closed could not be loaded. Reload the page to try again.</p>
  }

  const { decline, closure: mark } = closure.data
  if (decline && mark) {
    return (
      <>
        <h3 className="font-medium text-slate-900">Declined</h3>
        <DeclineFacts decline={decline} />
        <h3 className="font-medium text-slate-900">{mark.mark}</h3>
        <ClosureFacts closure={mark} />
      </>
    )
  }
  if (decline) return <DeclineFacts decline={decline} />
  if (mark) return <ClosureFacts closure={mark} />
  return null
}

// The closure mark: the reason, the note, who set it and when.
export function ClosureFacts({ closure }: { closure: LeadClosureMark }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
      <dt className="text-muted-foreground">Reason</dt>
      <dd className="text-slate-900">{closure.reason}</dd>
      {closure.note && (
        <>
          <dt className="text-muted-foreground">Note</dt>
          <dd className="whitespace-pre-line break-words text-slate-900">{closure.note}</dd>
        </>
      )}
      <dt className="text-muted-foreground">{closure.mark} by</dt>
      <dd className="text-slate-900">{closure.closedBy ?? "Not recorded"}</dd>
      <dt className="text-muted-foreground">{closure.mark} on</dt>
      <dd className="text-slate-900">
        {closure.closedAt ? formatDate(tanzaniaToday(new Date(closure.closedAt))) : "Not recorded"}
      </dd>
    </dl>
  )
}
