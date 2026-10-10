import { formatDate } from "@/lib/school-calendar"
import type { LeadHistoryChange, LeadHistoryEntry } from "@/lib/services/audit"

// Enrolled in a lead's history (#108), for describe.ts. The lead's status
// moves into and out of Enrolled only through the payments' recompute, which
// writes the lead fee profile with its cause just before it changes the
// status, in the same transaction.

const RECORD = "lead_fee_profiles"

// In the order an entry lists them.
const LABELS: Readonly<Record<string, string>> = {
  enrolled_trigger: "Enrolled by",
  enrolled_on: "Enrolled on",
  status_before_enrolled: "Status before Enrolled",
  recompute_cause: "Because",
  // The prior-sibling tick, and the Sibling discount kept for good (#113).
  prior_sibling: "Has a sibling already at Al-Rahmah",
  prior_sibling_name: "Sibling's name",
  prior_sibling_class: "Sibling's class",
  sibling_kept: "Keeps the Sibling discount",
}

export const ENROLMENT_FIELDS: readonly string[] = Object.keys(LABELS)

// The lead it belongs to, and the payment by id, which the entry says in words.
export const ENROLMENT_HIDDEN: ReadonlySet<string> = new Set(["lead_id", "enrolled_trigger_payment_id"])

const TRIGGERS: Readonly<Record<string, string>> = {
  payment: "A school-fee payment",
  academic_year_start: "The Academic-year start",
}

// Why the recompute ran, completing "because …".
const CAUSES: Readonly<Record<string, string>> = {
  payment: "a school-fee payment was recorded",
  payment_adjustment: "a payment was adjusted",
  discount: "a discount was granted",
  fee_schedule: "the Fee schedule changed",
  lead_details: "the lead's class, enrollment year or Day or boarding changed",
  family: "the lead's Family changed",
  academic_year_start: "the Academic-year start was reached",
  reopening: "the lead was reopened",
  sibling: "the lead's Sibling discount changed",
  prior_sibling: "Has a sibling already at Al-Rahmah was ticked or cleared",
}

function causeText(cause: unknown): string | null {
  return typeof cause === "string" ? (CAUSES[cause] ?? cause) : null
}

export function enrolmentLabel(record: string | null, field: string): string | null {
  return record === RECORD ? (LABELS[field] ?? null) : null
}

// A profile field's value in words; null for any other field or record.
export function enrolmentValue(record: string | null, field: string, value: unknown): string | null {
  if (record !== RECORD || value === null || value === undefined) return null
  if (field === "enrolled_trigger") return TRIGGERS[String(value)] ?? null
  if (field === "enrolled_on" && typeof value === "string") return formatDate(value)
  if (field === "recompute_cause") {
    const text = causeText(value)
    return text && text.charAt(0).toUpperCase() + text.slice(1)
  }
  return null
}

// The profile's cause after each of its entries, oldest first. An update
// records only the fields that changed, so a cause the same as the one before
// is carried forward from the profile's earlier entries.
export type EnrolmentCauses = readonly { id: number; cause: unknown }[]

export function enrolmentCauses(entries: readonly LeadHistoryEntry[]): EnrolmentCauses {
  const causes: { id: number; cause: unknown }[] = []
  let latest: unknown = null
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (entry.record !== RECORD) continue
    const written = entry.changes.find((c) => c.field === "recompute_cause")
    if (written) latest = written.to
    causes.push({ id: entry.id, cause: latest })
  }
  return causes
}

// The recompute writes the profile just before the status, so a status
// change's cause is the profile's cause as it stood just before it. Audit ids
// only grow, so an entry's id places it in that sequence.
function causeBefore(causes: EnrolmentCauses, entryId: number): unknown {
  const earlier = causes.filter((step) => step.id < entryId)
  return earlier[earlier.length - 1]?.cause ?? null
}

// A lead entry's summary when its status moved into or out of Enrolled, with
// the cause; null for any other change. Declining an Enrolled lead is a
// decline, so it is left to the lead's own summary.
export function enrolmentSummary(entry: LeadHistoryEntry, status: LeadHistoryChange | undefined, causes: EnrolmentCauses): string | null {
  if (!status) return null
  const because = causeText(causeBefore(causes, entry.id))
  const suffix = because ? `, because ${because}` : ""
  if (status.to === "Enrolled") return `enrolled the lead${suffix}`
  if (status.from === "Enrolled" && status.to !== "Declined") return `took the lead out of Enrolled${suffix}`
  return null
}

export function enrolmentProfileSummary(entry: LeadHistoryEntry): string {
  const trigger = entry.changes.find((c) => c.field === "enrolled_trigger")
  const tick = priorSiblingSummary(entry)
  if (tick && !trigger) return tick
  if (entry.action === "insert") return trigger?.to ? "recorded what enrolled the lead" : "recorded the lead's fee details"
  if (entry.action !== "update") return entry.action
  if (trigger?.to === null) return "cleared what enrolled the lead"
  if (trigger?.from === null) return "recorded what enrolled the lead"
  return "updated what enrolled the lead"
}

// Staff ticking, clearing or changing Has a sibling already at Al-Rahmah;
// null when the entry doesn't touch it.
function priorSiblingSummary(entry: LeadHistoryEntry): string | null {
  const tick = entry.changes.find((c) => c.field === "prior_sibling")
  if (tick?.to === true) return "ticked Has a sibling already at Al-Rahmah"
  if (tick?.to === false && entry.action === "update") return "cleared Has a sibling already at Al-Rahmah"
  if (entry.action === "update" && entry.changes.some((c) => c.field === "prior_sibling_name" || c.field === "prior_sibling_class")) {
    return "changed the sibling already at Al-Rahmah"
  }
  return null
}
