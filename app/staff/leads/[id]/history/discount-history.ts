import type { LeadHistoryEntry } from "@/lib/services/audit"
import { DISCOUNT_NAMES, type DiscountKind, type DiscountRequestState } from "@/lib/services/discounts"

import { DISCOUNT_STATE_LABELS } from "../discount-outcome"

// A Staff child or Qualified orphan request's history entries (#112), for
// describe.ts.

const RECORD = "discount_requests"

// Labels for this table's own fields only, so another table's `note` or
// `state` keeps its own words.
const LABELS: Readonly<Record<string, string>> = {
  kind: "Discount",
  note: "Note for the Manager",
  state: "Request",
  refusal_reason: "Reason for refusing",
}

// Shown by the entry itself: its lead, who acted and when. The request id
// only stops a retried Request sending it twice.
export const DISCOUNT_HIDDEN: ReadonlySet<string> = new Set([
  "lead_id",
  "requested_by",
  "requested_at",
  "decided_by",
  "decided_at",
  "request_id",
])

export function discountLabel(record: string | null, field: string): string | null {
  return record === RECORD ? (LABELS[field] ?? null) : null
}

// A request's kind or state in words; null for any other field or record.
export function discountValue(record: string | null, field: string, value: unknown): string | null {
  if (record !== RECORD) return null
  if (field === "kind") return DISCOUNT_NAMES[value as DiscountKind] ?? null
  if (field === "state") return DISCOUNT_STATE_LABELS[value as DiscountRequestState] ?? null
  return null
}

export function discountSummary(entry: LeadHistoryEntry): string | null {
  if (entry.record !== RECORD) return null
  if (entry.action === "insert") {
    const kind = entry.changes.find((c) => c.field === "kind")?.to
    const name = DISCOUNT_NAMES[kind as DiscountKind]
    return name ? `requested a ${name} discount` : "requested a discount"
  }
  if (entry.action !== "update") return entry.action
  switch (entry.changes.find((c) => c.field === "state")?.to) {
    case "granted":
      return "granted the discount request"
    case "refused":
      return "refused the discount request"
    default:
      return "changed the discount request"
  }
}
