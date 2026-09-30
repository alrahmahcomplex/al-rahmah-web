import { formatDate } from "@/lib/school-calendar"
import type { LeadHistoryEntry } from "@/lib/services/audit"

// A lead's history entry in plain words: who, what they did, and each field's
// old and new value. A field, table or action kind this file does not know
// shows under its raw name with its raw value (ADR 4), so an entry a later
// slice writes reads before anyone adds a label for it.

// `from` is null on a creation, which has no old value.
export type DescribedChange = { label: string; from: string | null; to: string }

export type DescribedEntry = {
  id: number
  at: string
  actor: string
  summary: string
  changes: DescribedChange[]
}

const LABELS: Record<string, string> = {
  // The lead.
  admission_number: "Admission Number",
  student_name: "Student name",
  class_name: "Class",
  enrollment_year: "Enrollment year",
  day_or_boarding: "Day or boarding",
  status: "Status",
  closure: "Closure",
  visit_date: "Visit date",
  guardian_contact_id: "Parent or guardian",
  returning_family_joined: "Returning family: joined a Family",
  returning_family_reapplied: "Returning family: re-applied",
  // Its parent or guardian.
  full_name: "Full name",
  relationship: "Relationship",
  relationship_description: "Relationship details",
  phone: "Phone",
  whatsapp: "WhatsApp",
  origin: "Added from",
  pending_family_match_id: "Unconfirmed Family match",
}

const ORIGINS: Record<string, string> = {
  front_desk: "Front desk",
  admission_form: "Admission form",
}

function raw(value: unknown): string {
  if (typeof value === "string") return value
  if (typeof value === "boolean") return value ? "Yes" : "No"
  return JSON.stringify(value)
}

function display(field: string, value: unknown, contactNames: Readonly<Record<string, string>>): string {
  if (value === null || value === undefined) return field === "whatsapp" ? "Same as phone" : "None"
  switch (field) {
    case "visit_date":
      return typeof value === "string" ? formatDate(value) : raw(value)
    case "guardian_contact_id":
    case "pending_family_match_id":
      return contactNames[String(value)] ?? raw(value)
    case "origin":
      return ORIGINS[String(value)] ?? raw(value)
    default:
      return raw(value)
  }
}

// A creation lists what the new row holds; empty fields and unset flags say
// nothing there.
function isEmpty(value: unknown) {
  return value === null || value === undefined || value === false
}

function article(word: string) {
  return /^[aeiou]/i.test(word) ? "an" : "a"
}

function summarize(entry: LeadHistoryEntry, contactNames: Readonly<Record<string, string>>): string {
  const changed = new Map(entry.changes.map((c) => [c.field, c]))
  const insert = entry.action === "insert"

  if (entry.record === "lead") {
    if (insert) return changed.get("returning_family_joined")?.to === true ? "created the lead and joined a Family" : "created the lead"
    if (entry.action !== "update") return entry.action

    const status = changed.get("status")
    if (status?.from === "Applied" && status.to === "Visited") return "recorded a visit"
    const leftFamily = changed.get("returning_family_joined")?.to === false
    // Separating gives the lead a contact of its own; confirming moves it onto
    // the matched Family's contact; rejecting keeps the contact it has.
    if (changed.has("guardian_contact_id")) return leftFamily ? "separated the lead from its Family" : "confirmed the Family match"
    if (leftFamily) return "rejected the Family match"
    return "changed the lead"
  }

  if (entry.record === "contact") {
    const name = contactNames[entry.recordId ?? ""]
    const who = name ? `the parent or guardian ${name}` : "a parent or guardian"
    const match = changed.get("pending_family_match_id")
    if (insert) return match?.to ? `added ${who}, matched to a known Family but not yet confirmed` : `added ${who}`
    if (entry.action !== "update") return entry.action
    if (match && match.to === null) return name ? `closed the unconfirmed Family match of ${name}` : "closed an unconfirmed Family match"
    if (match) return `matched ${who} to a known Family, not yet confirmed`
    return `changed ${who}`
  }

  if (entry.record !== null) {
    if (insert) return `added ${article(entry.record)} ${entry.record} record`
    if (entry.action === "update") return `changed ${article(entry.record)} ${entry.record} record`
    return entry.action
  }

  // An action event: something done that changed no row.
  return `recorded ${entry.action}`
}

// Known fields in the order the lead screen shows them, then unknown ones as
// they came.
const ORDER = Object.keys(LABELS)

function rank(field: string) {
  const at = ORDER.indexOf(field)
  return at === -1 ? ORDER.length : at
}

export function describeLeadHistoryEntry(
  entry: LeadHistoryEntry,
  contactNames: Readonly<Record<string, string>>,
): DescribedEntry {
  const fromOld = entry.record !== null && entry.action === "update"
  return {
    id: entry.id,
    at: entry.at,
    actor: entry.actor,
    summary: summarize(entry, contactNames),
    changes: entry.changes
      .filter((c) => fromOld || !isEmpty(c.to))
      .sort((a, b) => rank(a.field) - rank(b.field))
      .map((c) => ({
        label: LABELS[c.field] ?? c.field,
        from: fromOld ? display(c.field, c.from, contactNames) : null,
        to: display(c.field, c.to, contactNames),
      })),
  }
}
