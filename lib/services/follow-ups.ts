import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The follow-up module (slice 7, #28). A follow-up is a planned contact with
// a lead: a date in Tanzania time and an optional note. Follow-ups are never
// edited; changing a date adds a follow-up that replaces the earlier one and
// carries a reason. Every write is a database function that checks
// follow_ups.record and refuses a closed lead, so these calls only translate
// what the database answers.

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

export type LeadFollowUps = {
  // The lead's open follow-up, if it has one.
  open: FollowUp | null
  // Every other follow-up the lead has had, newest first.
  earlier: FollowUp[]
}

export type FollowUpField = "due_on" | "note" | "reason"

export type FollowUpWriteError =
  | { kind: "forbidden" }
  | { kind: "invalid"; field: FollowUpField | null }
  | { kind: "not-found" }
  // The lead is Declined, Inactive or Archived.
  | { kind: "read-only" }
  // The lead already has an open follow-up, or the one being changed is no
  // longer open.
  | { kind: "conflict" }
  | { kind: "unavailable" }

export type LeadFollowUpsError = { kind: "not-found" } | { kind: "unavailable" }

const FIELDS = new Set<string>(["due_on", "note", "reason"])

function invalidField(details: string | null | undefined): FollowUpField | null {
  try {
    const field = JSON.parse(details ?? "")?.field
    return typeof field === "string" && FIELDS.has(field) ? (field as FollowUpField) : null
  } catch {
    return null
  }
}

function writeError(error: PostgrestError, what: string): FollowUpWriteError {
  // 42501: the function isn't granted to the caller at all, as for someone
  // signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  // A malformed id is a missing record, not an outage.
  if (error.message === "not_found" || error.code === "22P02") return { kind: "not-found" }
  if (error.message === "lead_closed") return { kind: "read-only" }
  if (error.message === "conflict") return { kind: "conflict" }
  if (error.message === "invalid") return { kind: "invalid", field: invalidField(error.details) }
  // A date Postgres can't read.
  if (error.code === "22007" || error.code === "22008") return { kind: "invalid", field: "due_on" }
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

// The lead's follow-ups. Row-level security shows them only to staff who may
// view leads, so for anyone else there are none.
export async function getLeadFollowUps(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadFollowUps, LeadFollowUpsError>> {
  const { data, error } = await supabase
    .from("follow_ups")
    .select("id, due_on, note, replaces_id, change_reason, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .overrideTypes<FollowUpRow[], { merge: false }>()

  if (error && error.code === "22P02") return { ok: false, error: { kind: "not-found" } }
  if (error) {
    console.error("Could not read a lead's follow-ups", error)
    return { ok: false, error: { kind: "unavailable" } }
  }

  // Open while no later follow-up replaces it. Follow-up records (#91) will
  // close one too.
  const rows = (data ?? []).map(toFollowUp)
  const replaced = new Set(rows.map((row) => row.replacesId).filter((id) => id !== null))
  const open = rows.find((row) => !replaced.has(row.id)) ?? null
  return { ok: true, data: { open, earlier: rows.filter((row) => row !== open) } }
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
