import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

export type ActionKind = "invite_sent"
export type RecordActionError = "not-permitted" | "lead-required" | "unavailable"

// Records an action event (something staff did that changed no row) in the
// audit log, under the signed-in staff member. The database checks that
// their role holds the permission the kind needs.
export async function recordAction(
  supabase: SupabaseClient,
  kind: ActionKind,
  leadId: string | null,
  details: Record<string, unknown>,
): Promise<Result<null, RecordActionError>> {
  const { error } = await supabase.rpc("record_action", { kind, lead_id: leadId, details })
  if (!error) return { ok: true, data: null }
  if (error.message === "not_permitted") return { ok: false, error: "not-permitted" }
  if (error.message === "lead_required") return { ok: false, error: "lead-required" }
  return { ok: false, error: "unavailable" }
}

// ---------------------------------------------------------------------------
// A lead's history (ADR 4): the lead's own entries and those of every
// parent/guardian contact it is or was linked to, newest first. Field names
// and values come back as stored, so a key no screen knows yet still reads;
// the history screen gives them plain labels.
// ---------------------------------------------------------------------------

// One changed field. `from` is null on a creation or an action event.
export type LeadHistoryChange = { field: string; from: unknown; to: unknown }

export type LeadHistoryEntry = {
  id: number
  at: string
  // The staff member's name, looked up when read, or the Admission form, the
  // workbook import or the system.
  actor: string
  // What changed: the lead, one of its contacts, a later slice's table under
  // its own name, or nothing (an action event).
  record: "lead" | "contact" | (string & {}) | null
  recordId: string | null
  // insert, update, or an action kind.
  action: string
  changes: LeadHistoryChange[]
}

// The entries, and the current name of every contact they mention.
export type LeadHistory = { entries: LeadHistoryEntry[]; contactNames: Record<string, string> }

export type LeadHistoryError = "forbidden" | "not-found" | "unavailable"

type LeadHistoryRow = {
  id: number
  created_at: string
  table_name: string | null
  row_id: string | null
  action: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  actor_kind: string
  actor_name: string | null
}

const ACTORS: Record<string, string> = {
  public_form: "Admission form",
  workbook_import: "Workbook import",
  system: "System",
}

const RECORDS: Record<string, string> = {
  leads: "lead",
  guardian_contacts: "contact",
}

// Stored alongside a row, never a change anyone made.
const BOOKKEEPING = new Set(["id", "created_at", "student_name_key"])

// The columns that point at a contact, whose names the screen shows.
const CONTACT_COLUMNS = ["guardian_contact_id", "pending_family_match_id"]

function toEntry(row: LeadHistoryRow): LeadHistoryEntry {
  const oldValues = row.old_values ?? {}
  const newValues = row.new_values ?? {}
  return {
    id: row.id,
    at: row.created_at,
    actor: row.actor_kind === "staff" ? (row.actor_name ?? "A former staff member") : (ACTORS[row.actor_kind] ?? row.actor_kind),
    record: row.table_name === null ? null : (RECORDS[row.table_name] ?? row.table_name),
    recordId: row.row_id,
    action: row.action,
    changes: Object.keys(newValues)
      .filter((field) => !BOOKKEEPING.has(field))
      .map((field) => ({ field, from: oldValues[field] ?? null, to: newValues[field] ?? null })),
  }
}

// Reads a lead's history. Needs leads.view, as reading the lead does.
export async function getLeadHistory(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadHistory, LeadHistoryError>> {
  const { data, error } = await supabase.rpc("lead_history", { lead_id: leadId })
  if (error) {
    // Refused by the function, or by the grant for visitors not signed in.
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    // A malformed id is a missing lead, not an outage.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not read a lead's history", error)
    return { ok: false, error: "unavailable" }
  }

  const entries = ((data ?? []) as LeadHistoryRow[]).map(toEntry)

  const contactIds = new Set<string>()
  for (const entry of entries) {
    if (entry.record === "contact" && entry.recordId) contactIds.add(entry.recordId)
    for (const change of entry.changes) {
      if (!CONTACT_COLUMNS.includes(change.field)) continue
      for (const value of [change.from, change.to]) if (typeof value === "string") contactIds.add(value)
    }
  }

  return { ok: true, data: { entries, contactNames: await readContactNames(supabase, [...contactIds]) } }
}

// Ids per request, so a long history never makes one oversized URL.
const CONTACT_NAMES_PER_REQUEST = 100

// The current name of each contact. The names only decorate the history, so
// a batch that can't be read leaves those contacts unnamed (the screen shows
// their ids) rather than hiding the history.
async function readContactNames(supabase: SupabaseClient, ids: string[]): Promise<Record<string, string>> {
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += CONTACT_NAMES_PER_REQUEST) batches.push(ids.slice(i, i + CONTACT_NAMES_PER_REQUEST))

  const results = await Promise.all(
    batches.map((batch) => supabase.from("guardian_contacts").select("id, full_name").in("id", batch)),
  )

  const names: Record<string, string> = {}
  for (const { data, error } of results) {
    if (error) {
      console.error("Could not read the contacts a lead's history names", error)
      continue
    }
    for (const contact of data as { id: string; full_name: string }[]) names[contact.id] = contact.full_name
  }
  return names
}
