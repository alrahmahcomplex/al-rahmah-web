import type { LeadHistoryEntry } from "@/lib/services/audit"

// Payment adjustments in a lead's history (#110), for describe.ts. An
// adjustment is its own entry, listing what the payment should have said. When
// it changed the lead's Seat priority, the same transaction writes a
// `seat_priority_changed` entry from what to what; an Enrolled change it
// caused shows as the lead's own entry, with "because a payment was adjusted".

const RECORD = "payment_adjustments"
const PRIORITY_CHANGED = "seat_priority_changed"

// The entry already says who made the adjustment, and when. The lead, the
// payment's id, the order and the request id are the database's own.
export const ADJUSTMENT_HIDDEN: ReadonlySet<string> = new Set([
  "lead_id",
  "payment_id",
  "sequence",
  "recorded_by",
  "recorded_at",
  "request_id",
])

// What changed the priority is the entry's own summary.
export const PRIORITY_CHANGE_HIDDEN: ReadonlySet<string> = new Set(["cause"])

const LABELS: Readonly<Record<string, string>> = {
  reason: "Reason",
  voided: "Void",
}

export function isPriorityChange(entry: LeadHistoryEntry) {
  return entry.record === null && entry.action === PRIORITY_CHANGED
}

export function adjustmentLabel(entry: LeadHistoryEntry, field: string): string | null {
  if (entry.record === RECORD) return LABELS[field] ?? null
  if (isPriorityChange(entry) && field === "priority") return "Seat priority"
  return null
}

// A value in words; null when the general wording already fits.
export function adjustmentValue(entry: LeadHistoryEntry, field: string, value: unknown): string | null {
  if (isPriorityChange(entry) && field === "priority" && value === null) return "None"
  return null
}

export function adjustmentSummary(entry: LeadHistoryEntry): string | null {
  if (isPriorityChange(entry)) return "changed the Seat priority, because a payment was adjusted"
  if (entry.record !== RECORD) return null
  if (entry.action !== "insert") return entry.action
  return entry.changes.some((c) => c.field === "voided" && c.to === true) ? "voided a school-fee payment" : "adjusted a school-fee payment"
}
