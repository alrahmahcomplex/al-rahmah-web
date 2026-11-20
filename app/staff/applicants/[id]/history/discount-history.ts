import type { LeadHistoryEntry } from "@/lib/services/audit"
import { FEE_DISCOUNT_NAMES, type FeeDiscountKind } from "@/lib/services/discounts"

import { DISCOUNT_STATE_LABELS } from "../discount-outcome"

// A Staff child, Qualified orphan or Sibling request's history entries (#112,
// #428), for describe.ts.

const RECORD = "discount_requests"

// Labels for this table's own fields only, so another table's `note` or
// `state` keeps its own words.
const LABELS: Readonly<Record<string, string>> = {
  kind: "Discount",
  note: "Note for the Manager",
  state: "Request",
  refusal_reason: "Reason for refusing",
  // A Sibling request's own fields (#428).
  sibling_of_lead_id: "Sibling of",
  withdrawn_reason: "Closed because",
  fee_edit: "Fee edit",
  fee_edit_reason: "Reason for dismissing",
}

// Shown by the entry itself: its lead, who acted and when. The request id
// only stops a retried Request sending it twice. A Sibling request's groups
// are ids; "Sibling of" says who the request is about.
export const DISCOUNT_HIDDEN: ReadonlySet<string> = new Set([
  "lead_id",
  "requested_by",
  "requested_at",
  "decided_by",
  "decided_at",
  "request_id",
  "group_id",
  "merge_from_group_id",
  "withdrawn_by",
  "fee_edit_closed_by",
  "fee_edit_closed_at",
])

// Only a Sibling request is ever withdrawn, by the system.
const STATES: Readonly<Record<string, string>> = { ...DISCOUNT_STATE_LABELS, withdrawn: "Withdrawn" }

const WITHDRAWN_REASONS: Readonly<Record<string, string>> = {
  left_group: "The applicant left the sibling group",
  already_linked: "The applicant already counts as a sibling",
}

// The 10% a request granted after enrolment still needs by hand.
const FEE_EDITS: Readonly<Record<string, string>> = {
  needed: "Needed",
  applied: "10% applied",
  dismissed: "Dismissed",
}

export function discountLabel(record: string | null, field: string): string | null {
  return record === RECORD ? (LABELS[field] ?? null) : null
}

// A request's kind, state or Sibling fee edit in words; null for any other
// field or record.
export function discountValue(record: string | null, field: string, value: unknown): string | null {
  if (record !== RECORD) return null
  if (field === "kind") return FEE_DISCOUNT_NAMES[value as FeeDiscountKind] ?? null
  if (field === "state") return STATES[String(value)] ?? null
  if (field === "withdrawn_reason") return WITHDRAWN_REASONS[String(value)] ?? null
  if (field === "fee_edit") return FEE_EDITS[String(value)] ?? null
  return null
}

// A fee edit closed as applied keeps the Manual Sibling fee edit's reason,
// which that edit's own entry already shows; only a dismissal's reason is
// written here.
export function withoutAppliedReason(entry: LeadHistoryEntry): LeadHistoryEntry {
  if (entry.record !== RECORD || !entry.changes.some((c) => c.field === "fee_edit" && c.to === "applied")) return entry
  return { ...entry, changes: entry.changes.filter((c) => c.field !== "fee_edit_reason") }
}

// Each request's kind, by request id, from its creation. A later entry
// records only what changed, so it reads its kind from here.
export type DiscountKinds = ReadonlyMap<string, unknown>

export function discountKinds(entries: readonly LeadHistoryEntry[]): DiscountKinds {
  const kinds = new Map<string, unknown>()
  for (const entry of entries) {
    if (entry.record !== RECORD || entry.action !== "insert" || !entry.recordId) continue
    kinds.set(entry.recordId, entry.changes.find((c) => c.field === "kind")?.to)
  }
  return kinds
}

export function discountSummary(entry: LeadHistoryEntry, kinds: DiscountKinds): string | null {
  if (entry.record !== RECORD) return null
  const changed = new Map(entry.changes.map((c) => [c.field, c]))
  if (entry.action === "insert") {
    const kind = changed.get("kind")?.to
    if (kind === "sibling") return "sent a Sibling request"
    const name = FEE_DISCOUNT_NAMES[kind as FeeDiscountKind]
    return name ? `requested a ${name} discount` : "requested a discount"
  }
  if (entry.action !== "update") return entry.action
  const sibling = kinds.get(entry.recordId ?? "") === "sibling"
  switch (changed.get("state")?.to) {
    case "granted":
      return sibling ? "granted the Sibling request" : "granted the discount request"
    case "refused":
      return sibling ? "refused the Sibling request" : "refused the discount request"
    case "withdrawn":
      return "closed the Sibling request without a decision"
  }
  switch (changed.get("fee_edit")?.to) {
    case "applied":
      return "applied the 10% for the granted Sibling request"
    case "dismissed":
      return "dismissed the fee edit for the granted Sibling request"
  }
  return "changed the discount request"
}
