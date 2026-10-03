import type { LeadHistoryEntry } from "@/lib/services/audit"
import type { ReopeningSource, ReopeningState } from "@/lib/services/reopening-requests"

import { SOURCE_LABELS, STATE_LABELS } from "../reopening-outcome"

// A Reopening request's history entries (#99), for describe.ts.

export const REOPENING_LABELS: Readonly<Record<string, string>> = {
  source: "Raised from",
  reason: "Reason for reopening",
  state: "Request",
  rejection_reason: "Reason for rejecting",
}

// Shown by the entry itself: its lead, who acted and when.
export const REOPENING_HIDDEN: ReadonlySet<string> = new Set([
  "lead_id",
  "requested_by",
  "requested_at",
  "decided_by",
  "decided_at",
])

// A request's source or state in words; null for any other field.
export function reopeningValue(field: string, value: unknown): string | null {
  if (field === "source") return SOURCE_LABELS[value as ReopeningSource] ?? null
  if (field === "state") return STATE_LABELS[value as ReopeningState] ?? null
  return null
}

export function reopeningSummary(entry: LeadHistoryEntry): string {
  if (entry.action === "insert") return "requested reopening"
  if (entry.action !== "update") return entry.action
  switch (entry.changes.find((c) => c.field === "state")?.to) {
    case "withdrawn":
      return "withdrew the reopening request"
    case "approved":
      return "approved the reopening request"
    case "rejected":
      return "rejected the reopening request"
    default:
      return "changed the reopening request"
  }
}
