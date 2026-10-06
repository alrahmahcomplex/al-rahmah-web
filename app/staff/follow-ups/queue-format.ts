import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { FollowUpQueueItem } from "@/lib/services/follow-ups"

// The words on a Follow-ups queue row.

export function overdueText(days: number): string {
  return days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`
}

// How and on which day, in Tanzania, the family was last reached.
export function lastContactText(lastContact: FollowUpQueueItem["lastContact"]): string {
  if (!lastContact) return "No contact recorded yet"
  return `Last contact: ${lastContact.method} on ${formatDate(tanzaniaToday(new Date(lastContact.contactedAt)))}`
}

// Upcoming's rows due today, shown under Today, and the later ones, each in
// the order they came.
export function splitToday<T extends { dueOn: string }>(items: readonly T[], today: string): { today: T[]; later: T[] } {
  return {
    today: items.filter((item) => item.dueOn <= today),
    later: items.filter((item) => item.dueOn > today),
  }
}
