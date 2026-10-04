import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The follow-up module (slice 7, #28). A follow-up is a planned contact with
// a lead: a date in Tanzania time and an optional note. Follow-ups are never
// edited; changing a date adds a follow-up that replaces the earlier one and
// carries a reason. A follow-up record is a contact staff made with the
// family; recording one closes the open follow-up. Every write is a database
// function that checks follow_ups.record and refuses a closed lead, so these
// calls only translate what the database answers.

export type FollowUp = {
  id: string
  // YYYY-MM-DD, a calendar date in Tanzania.
  dueOn: string
  note: string | null
  // The follow-up this one replaced when its date was changed, and why.
  replacesId: string | null
  changeReason: string | null
  createdAt: string
}

export const CONTACT_METHODS = ["Phone call", "WhatsApp", "SMS", "In-person"] as const
export type ContactMethod = (typeof CONTACT_METHODS)[number]

// How a recorded contact ended: with the next follow-up planned, with the
// lead declined (#94), or with no next date on an Enrolled lead.
export type FollowUpOutcomeKind = "next_date" | "lead_declined" | "lead_enrolled"

// A contact staff made with the family, or a follow-up that ended because its
// lead closed (#93).
export type FollowUpRecord = {
  id: string
  kind: "contact" | "closed_with_lead"
  // The follow-up it closed; null for an unplanned contact.
  followUpId: string | null
  outcome: FollowUpOutcomeKind | null
  // Why a follow-up closed with its lead.
  cause: "declined" | "inactive" | "archived" | null
  comment: string | null
  method: ContactMethod | null
  // Who made the contact, by name even after they are deactivated.
  contactedBy: { id: string; name: string | null } | null
  contactedAt: string | null
  enteredAt: string
  // The follow-up planned with it, for the next_date outcome.
  nextFollowUpId: string | null
}

export type LeadFollowUps = {
  // The lead's open follow-up, if it has one.
  open: FollowUp | null
  // Every other follow-up the lead has had, newest first.
  earlier: FollowUp[]
  // Every recorded contact and ending, newest first.
  records: FollowUpRecord[]
}

export type FollowUpField =
  | "due_on"
  | "note"
  | "reason"
  | "comment"
  | "method"
  | "contacted_by"
  | "contacted_at"
  | "outcome"
  | "next_due_on"
  | "next_note"

export type FollowUpWriteError =
  | { kind: "forbidden" }
  | { kind: "invalid"; field: FollowUpField | null }
  | { kind: "not-found" }
  // The lead is Declined, Inactive or Archived.
  | { kind: "read-only" }
  // The lead already has an open follow-up, or the one being changed or
  // recorded is no longer the open one.
  | { kind: "conflict" }
  | { kind: "unavailable" }

export type LeadFollowUpsError = { kind: "not-found" } | { kind: "unavailable" }

const FIELDS = new Set<string>([
  "due_on",
  "note",
  "reason",
  "comment",
  "method",
  "contacted_by",
  "contacted_at",
  "outcome",
  "next_due_on",
  "next_note",
])

function invalidField(details: string | null | undefined): FollowUpField | null {
  try {
    const field = JSON.parse(details ?? "")?.field
    return typeof field === "string" && FIELDS.has(field) ? (field as FollowUpField) : null
  } catch {
    return null
  }
}

function writeError(error: PostgrestError, what: string, dateField: FollowUpField = "due_on"): FollowUpWriteError {
  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  // A malformed id is a missing record, not an outage.
  if (error.message === "not_found" || error.code === "22P02") return { kind: "not-found" }
  if (error.message === "lead_closed") return { kind: "read-only" }
  if (error.message === "conflict") return { kind: "conflict" }
  if (error.message === "invalid") return { kind: "invalid", field: invalidField(error.details) }
  // A date Postgres can't read.
  if (error.code === "22007" || error.code === "22008") return { kind: "invalid", field: dateField }
  console.error(`Could not ${what}`, error)
  return { kind: "unavailable" }
}

type FollowUpRow = {
  id: string
  due_on: string
  note: string | null
  replaces_id: string | null
  change_reason: string | null
  created_at: string
}

function toFollowUp(row: FollowUpRow): FollowUp {
  return {
    id: row.id,
    dueOn: row.due_on,
    note: row.note,
    replacesId: row.replaces_id,
    changeReason: row.change_reason,
    createdAt: row.created_at,
  }
}

type RecordRow = {
  id: string
  kind: FollowUpRecord["kind"]
  follow_up_id: string | null
  outcome: FollowUpOutcomeKind | null
  cause: FollowUpRecord["cause"]
  comment: string | null
  method: ContactMethod | null
  contacted_by: string | null
  contacted_at: string | null
  entered_at: string
  next_follow_up_id: string | null
}

// Newest first by when the contact happened; an ending, by when it was
// written.
function newestFirst(a: FollowUpRecord, b: FollowUpRecord) {
  const at = (record: FollowUpRecord) => Date.parse(record.contactedAt ?? record.enteredAt)
  return at(b) - at(a) || Date.parse(b.enteredAt) - Date.parse(a.enteredAt) || b.id.localeCompare(a.id)
}

// The lead's follow-ups and follow-up records. Row-level security shows them
// only to staff who may view leads, so for anyone else there are none.
export async function getLeadFollowUps(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadFollowUps, LeadFollowUpsError>> {
  const [plans, contacts] = await Promise.all([
    supabase
      .from("follow_ups")
      .select("id, due_on, note, replaces_id, change_reason, created_at")
      .eq("lead_id", leadId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .overrideTypes<FollowUpRow[], { merge: false }>(),
    supabase
      .from("follow_up_records")
      .select("id, kind, follow_up_id, outcome, cause, comment, method, contacted_by, contacted_at, entered_at, next_follow_up_id")
      .eq("lead_id", leadId)
      .overrideTypes<RecordRow[], { merge: false }>(),
  ])

  const error = plans.error ?? contacts.error
  if (error && error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
  if (error) {
    console.error("Could not read a lead's follow-ups", error)
    return { ok: false, error: { kind: "unavailable" } }
  }

  const recordRows = contacts.data ?? []
  const names = new Map<string, string>()
  if (recordRows.some((row) => row.contacted_by !== null)) {
    // Staff rows are for administrators only, so the names come through a
    // function that returns just the names of the staff on these records.
    const staff = await supabase.rpc("follow_up_record_staff", { lead_id: leadId })
    if (staff.error) {
      console.error("Could not read the names on a lead's follow-up records", staff.error)
      return { ok: false, error: { kind: "unavailable" } }
    }
    for (const row of (staff.data ?? []) as { id: string; full_name: string }[]) names.set(row.id, row.full_name)
  }

  const records: FollowUpRecord[] = recordRows
    .map((row) => ({
      id: row.id,
      kind: row.kind,
      followUpId: row.follow_up_id,
      outcome: row.outcome,
      cause: row.cause,
      comment: row.comment,
      method: row.method,
      contactedBy: row.contacted_by === null ? null : { id: row.contacted_by, name: names.get(row.contacted_by) ?? null },
      contactedAt: row.contacted_at,
      enteredAt: row.entered_at,
      nextFollowUpId: row.next_follow_up_id,
    }))
    .sort(newestFirst)

  // Open while no later follow-up replaces it and no record closes it.
  const rows = (plans.data ?? []).map(toFollowUp)
  const ended = new Set<string>()
  for (const row of rows) if (row.replacesId) ended.add(row.replacesId)
  for (const record of records) if (record.followUpId) ended.add(record.followUpId)
  const open = rows.find((row) => !ended.has(row.id)) ?? null
  return { ok: true, data: { open, earlier: rows.filter((row) => row !== open), records } }
}

// Plans the next contact with a lead that has no open follow-up. The date is
// from today to 365 days ahead in Tanzania; the note at most 500 characters.
// Needs follow_ups.record.
export async function scheduleFollowUp(
  supabase: SupabaseClient,
  leadId: string,
  plan: { dueOn: string; note?: string | null },
): Promise<Result<{ followUpId: string }, FollowUpWriteError>> {
  const { data, error } = await supabase.rpc("schedule_follow_up", {
    lead_id: leadId,
    due_on: plan.dueOn,
    note: plan.note ?? null,
  })
  if (error) return { ok: false, error: writeError(error, "schedule a follow-up") }
  return { ok: true, data: { followUpId: data as string } }
}

// Moves an open follow-up to a new date, with a reason of 3 to 500
// characters. The earlier follow-up is kept; the new one keeps its note
// unless a new one is given. Needs follow_ups.record.
export async function changeFollowUpDate(
  supabase: SupabaseClient,
  followUpId: string,
  change: { dueOn: string; reason: string; note?: string | null },
): Promise<Result<{ followUpId: string }, FollowUpWriteError>> {
  const { data, error } = await supabase.rpc("change_follow_up_date", {
    follow_up_id: followUpId,
    due_on: change.dueOn,
    reason: change.reason,
    note: change.note ?? null,
  })
  if (error) return { ok: false, error: writeError(error, "change a follow-up's date") }
  return { ok: true, data: { followUpId: data as string } }
}

// What happened after a contact: the next follow-up planned, or, on an
// Enrolled lead, no next date.
export type RecordOutcome = { kind: "next_date"; dueOn: string; note?: string | null } | { kind: "lead_enrolled" }

export type ContactRecord = {
  // The open follow-up the contact completes, or null when none was planned.
  followUpId: string | null
  comment: string
  method: string
  // A staff member's id, from listContactStaff.
  contactedBy: string
  // An ISO timestamp, no later than now.
  contactedAt: string
  outcome: RecordOutcome
}

// Records a contact with the family and closes the lead's open follow-up. The
// comment is 3 to 2,000 characters; the next date is after today and at most
// 365 days ahead, and may be left out only on an Enrolled lead. If the open
// follow-up is no longer the one given, someone else recorded or changed it
// first, and nothing is recorded (`conflict`). Needs follow_ups.record.
export async function recordFollowUp(
  supabase: SupabaseClient,
  leadId: string,
  contact: ContactRecord,
): Promise<Result<{ recordId: string }, FollowUpWriteError>> {
  const next = contact.outcome.kind === "next_date" ? contact.outcome : null
  const { data, error } = await supabase.rpc("record_follow_up", {
    lead_id: leadId,
    follow_up_id: contact.followUpId,
    comment: contact.comment,
    method: contact.method,
    contacted_by: contact.contactedBy,
    contacted_at: contact.contactedAt,
    outcome: contact.outcome.kind,
    next_due_on: next?.dueOn ?? null,
    next_note: next?.note ?? null,
  })
  if (error) {
    // A date or time Postgres can't read: the next date when one was given.
    return { ok: false, error: writeError(error, "record a follow-up", next ? "next_due_on" : "contacted_at") }
  }
  return { ok: true, data: { recordId: data as string } }
}

export type ContactStaff = { id: string; name: string }

// The staff who may be named as having made a contact: active staff on a
// current role holding follow_ups.record, by name. Needs follow_ups.record.
export async function listContactStaff(
  supabase: SupabaseClient,
): Promise<Result<ContactStaff[], { kind: "forbidden" } | { kind: "unavailable" }>> {
  const { data, error } = await supabase.rpc("list_contact_staff")
  if (error) {
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: { kind: "forbidden" } }
    console.error("Could not list the staff who make contacts", error)
    return { ok: false, error: { kind: "unavailable" } }
  }
  return { ok: true, data: ((data ?? []) as { id: string; full_name: string }[]).map((row) => ({ id: row.id, name: row.full_name })) }
}
