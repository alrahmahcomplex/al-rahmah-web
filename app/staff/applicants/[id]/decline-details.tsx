import { KeyValueList, type KeyValueItem } from "@/components/kit"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { LeadDecline } from "@/lib/services/lead-closure"

// The decline on a Declined lead's banner: the reason, the explanation, who
// declined it and when, and the status it held before.
export function DeclineFacts({ decline }: { decline: LeadDecline }) {
  const items: KeyValueItem[] = [{ key: "Reason", value: decline.reason }]
  if (decline.explanation) items.push({ key: "Explanation", value: <span className="lr-pre">{decline.explanation}</span> })
  items.push(
    { key: "Declined by", value: decline.declinedBy ?? "Not recorded" },
    {
      key: "Declined on",
      value: decline.declinedAt ? formatDate(tanzaniaToday(new Date(decline.declinedAt))) : "Not recorded",
    },
  )
  if (decline.statusBefore) items.push({ key: "Status before", value: decline.statusBefore })
  return <KeyValueList items={items} />
}
