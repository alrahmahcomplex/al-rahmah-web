import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import type { FollowUpQueueItem } from "@/lib/services/follow-ups"

import { dueLabel } from "../leads/[id]/follow-up-outcome"

// The words on a Follow-ups queue row.

export function overdueText(days: number): string {
  return days === 1 ? "Overdue by 1 day" : `Overdue by ${days} days`
}

// A row's badge: how late a follow-up is or when it falls due, or, for a
// reopened lead with no follow-up date yet (#95), that it needs one. Such a
// lead sits in Overdue from the day it was approved.
export function rowDue(
  item: Pick<FollowUpQueueItem, "kind" | "dueOn" | "daysOverdue">,
  today: string,
): { text: string; overdue: boolean } {
  if (item.kind === "needs_date") return { text: "Needs a follow-up date", overdue: true }
  return item.daysOverdue > 0 ? { text: overdueText(item.daysOverdue), overdue: true } : dueLabel(item.dueOn, today)
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
