import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadClosure, type LeadDecline } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

// The decline on a Declined lead's banner: the reason, the explanation, who
// declined it and when, and the status it held before.
export async function DeclineDetails({ leadId }: { leadId: string }) {
  const closure = await getLeadClosure(await createClient(), leadId)
  if (!closure.ok) {
    return <p className="text-muted-foreground">The reason for the decline could not be loaded. Reload the page to try again.</p>
  }
  if (!closure.data.decline) return null
  return <DeclineFacts decline={closure.data.decline} />
}

export function DeclineFacts({ decline }: { decline: LeadDecline }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2">
      <dt className="text-muted-foreground">Reason</dt>
      <dd className="text-slate-900">{decline.reason}</dd>
      {decline.explanation && (
        <>
          <dt className="text-muted-foreground">Explanation</dt>
          <dd className="whitespace-pre-line break-words text-slate-900">{decline.explanation}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Declined by</dt>
      <dd className="text-slate-900">{decline.declinedBy ?? "Not recorded"}</dd>
      <dt className="text-muted-foreground">Declined on</dt>
      <dd className="text-slate-900">
        {decline.declinedAt ? formatDate(tanzaniaToday(new Date(decline.declinedAt))) : "Not recorded"}
      </dd>
      {decline.statusBefore && (
        <>
          <dt className="text-muted-foreground">Status before</dt>
          <dd className="text-slate-900">{decline.statusBefore}</dd>
        </>
      )}
    </dl>
  )
}
