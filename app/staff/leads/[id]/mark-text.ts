import type { MarkMove } from "@/lib/services/lead-closure"
import type { LeadStatus } from "@/lib/services/leads"

// The words of the Mark inactive and Archive dialog.

// The button and the dialog's send button, per move.
export const MARK_LABEL: Readonly<Record<MarkMove, string>> = { inactive: "Mark inactive", archived: "Archive" }

export function markTitle(mark: MarkMove, studentName: string): string {
  return mark === "inactive" ? `Mark ${studentName} inactive` : `Archive ${studentName}`
}

// What happens next, shown in the dialog before the mark is sent.
export function markConsequence(mark: MarkMove, status: LeadStatus): string {
  const after = mark === "inactive" ? "It can still be archived later." : "An Archived lead is never moved back to Inactive."
  return `The lead keeps its status, ${status}, and becomes read-only. ${after} Bringing it back needs a Manager's approval.`
}
