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
  declined_reason: "Declined reason",
  declined_explanation: "Decline explanation",
  status_before_decline: "Status before decline",
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
  // Its interviews.
  serial_number: "S/N",
  serial_year: "S/N enrollment year",
  interview_date: "Interview date",
  result: "Interview result",
  score: "Interview score",
  fee_status: "Interview fee",
  locked_amount: "Amount paid",
}

// Kept on a row for the database's sake, and already shown by the entry
// itself: who declined a lead and when; an interview's lead, and who
// registered it when.
const HIDDEN: Record<string, ReadonlySet<string>> = {
  lead: new Set(["declined_at", "declined_by"]),
  interviews: new Set(["lead", "registered_at", "registered_by"]),
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
    case "interview_date":
      return typeof value === "string" ? formatDate(value) : raw(value)
    case "guardian_contact_id":
    case "pending_family_match_id":
      return contactNames[String(value)] ?? raw(value)
    case "origin":
      return ORIGINS[String(value)] ?? raw(value)
    case "score":
      return typeof value === "number" ? `${value}%` : raw(value)
    case "locked_amount":
      return typeof value === "number" ? `TZS ${value.toLocaleString("en-US")}` : raw(value)
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

// Each contact's unconfirmed Family match over time, from the contact's own
// entries in the history, oldest first. Audit ids only grow, so an entry's id
// places it in that sequence.
type MatchTimeline = ReadonlyMap<string, readonly { id: number; match: unknown }[]>

function matchTimeline(entries: readonly LeadHistoryEntry[]): MatchTimeline {
  const timeline = new Map<string, { id: number; match: unknown }[]>()
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (entry.record !== "contact" || !entry.recordId) continue
    const match = entry.changes.find((c) => c.field === "pending_family_match_id")
    if (!match) continue
    timeline.set(entry.recordId, [...(timeline.get(entry.recordId) ?? []), { id: entry.id, match: match.to }])
  }
  return timeline
}

// The contact's unconfirmed match as it stood just before the given entry.
function matchBefore(timeline: MatchTimeline, contactId: unknown, entryId: number): unknown {
  if (typeof contactId !== "string") return null
  const earlier = (timeline.get(contactId) ?? []).filter((step) => step.id < entryId)
  return earlier[earlier.length - 1]?.match ?? null
}

// Every contact the given contact was ever matched to, unconfirmed.
function everMatchedTo(timeline: MatchTimeline, contactId: unknown): unknown[] {
  if (typeof contactId !== "string") return []
  return (timeline.get(contactId) ?? []).map((step) => step.match).filter((match) => match !== null)
}

function summarize(entry: LeadHistoryEntry, contactNames: Readonly<Record<string, string>>, timeline: MatchTimeline): string {
  const changed = new Map(entry.changes.map((c) => [c.field, c]))
  const insert = entry.action === "insert"

  if (entry.record === "lead") {
    if (insert) {
      if (changed.get("returning_family_joined")?.to !== true) return "created the lead"
      // The Admission form joins a Family only unconfirmed: the child's
      // contact carries a match that staff have yet to confirm.
      const unconfirmed = matchBefore(timeline, changed.get("guardian_contact_id")?.to, entry.id) !== null
      return unconfirmed ? "created the lead, matched to a known Family but not yet confirmed" : "created the lead and joined a Family"
    }
    if (entry.action !== "update") return entry.action

    const status = changed.get("status")
    if (status?.from === "Applied" && status.to === "Visited") return "recorded a visit"
    // The first interview result moves the lead on.
    if (status?.from === "Visited" && status.to === "Interviewed") return "moved the lead to Interviewed"
    // Confirming moves the lead onto the contact its own contact was matched
    // to. Any other move is a separation onto a copy of the contact.
    // Rejecting clears the Family cause and keeps the contact.
    const contact = changed.get("guardian_contact_id")
    if (contact) {
      return everMatchedTo(timeline, contact.from).includes(contact.to) ? "confirmed the Family match" : "separated the lead from its Family"
    }
    if (changed.get("returning_family_joined")?.to === false) return "rejected the Family match"
    if (changed.get("status")?.to === "Declined") return "declined the lead"
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

  if (entry.record === "interviews") {
    if (insert) return "registered the lead for interview"
    if (entry.action !== "update") return entry.action
    // The date, result and score are set together, so the first recording
    // sets the result where there was none, and a correction changes any of
    // the three that were already set.
    const result = changed.get("result")
    if (result && result.from === null) return "recorded the interview result"
    if (["interview_date", "result", "score"].some((field) => changed.get(field) && changed.get(field)?.from !== null)) {
      return "corrected the interview result"
    }
    return "changed the interview"
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

// A whole history, in the order it came (newest first). The Family entries
// are read against the contacts' own entries, so the history is described as
// a whole.
export function describeLeadHistory(
  entries: readonly LeadHistoryEntry[],
  contactNames: Readonly<Record<string, string>>,
): DescribedEntry[] {
  const timeline = matchTimeline(entries)
  return entries.map((entry) => describeEntry(entry, contactNames, timeline))
}

function describeEntry(entry: LeadHistoryEntry, contactNames: Readonly<Record<string, string>>, timeline: MatchTimeline): DescribedEntry {
  const fromOld = entry.record !== null && entry.action === "update"
  return {
    id: entry.id,
    at: entry.at,
    actor: entry.actor,
    summary: summarize(entry, contactNames, timeline),
    changes: entry.changes
      .filter((c) => !HIDDEN[entry.record ?? ""]?.has(c.field))
      .filter((c) => fromOld || !isEmpty(c.to))
      .sort((a, b) => rank(a.field) - rank(b.field))
      .map((c) => ({
        label: LABELS[c.field] ?? c.field,
        from: fromOld ? display(c.field, c.from, contactNames) : null,
        to: display(c.field, c.to, contactNames),
      })),
  }
}
