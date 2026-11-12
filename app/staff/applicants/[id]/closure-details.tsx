import { KeyValueList, type KeyValueItem } from "@/components/kit"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getLeadClosure, type LeadClosureMark } from "@/lib/services/lead-closure"
import { createClient } from "@/utils/supabase/server"

import { DeclineFacts } from "./decline-details"

// Why a closed lead is closed, on its banner: the decline, the closure mark,
// or both, each under its own heading when the lead carries both.
export async function ClosedLeadDetails({ leadId }: { leadId: string }) {
  const closure = await getLeadClosure(await createClient(), leadId)
  if (!closure.ok) {
    return <p className="lr-quiet">Why this application is closed could not be loaded. Reload the page to try again.</p>
  }

  const { decline, closure: mark } = closure.data
  if (decline && mark) {
    return (
      <>
        <h3 className="lr-sub">Declined</h3>
        <DeclineFacts decline={decline} />
        <h3 className="lr-sub">{mark.mark}</h3>
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
  const items: KeyValueItem[] = [{ key: "Reason", value: closure.reason }]
  if (closure.note) items.push({ key: "Note", value: <span className="lr-pre">{closure.note}</span> })
  items.push(
    { key: `${closure.mark} by`, value: closure.closedBy ?? "Not recorded" },
    {
      key: `${closure.mark} on`,
      value: closure.closedAt ? formatDate(tanzaniaToday(new Date(closure.closedAt))) : "Not recorded",
    },
  )
  return <KeyValueList items={items} />
}
