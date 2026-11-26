import type { SupabaseClient } from "@supabase/supabase-js"

import type { LeadClass } from "./leads"
import type { Result } from "./result"
import { streamName, type StreamTakes } from "./streams"

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

// The entries, and the current name of every contact, sibling and stream they
// mention: a sibling as "Name · Admission Number" (#428). Each stream also
// comes with when it was opened, as the database wrote it, so the screen can
// tell a stream opened to answer a request from one that was already there.
export type LeadHistory = {
  entries: LeadHistoryEntry[]
  contactNames: Record<string, string>
  leadNames: Record<string, string>
  streamNames: Record<string, string>
  streamOpenedAt: Record<string, string>
}

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

// The columns that point at a contact, a sibling or a stream, whose names the
// screen shows.
const CONTACT_COLUMNS = ["guardian_contact_id", "pending_family_match_id"]
const LEAD_COLUMNS: Readonly<Record<string, string>> = {
  sibling_group_members: "sibling_of_lead_id",
  discount_requests: "sibling_of_lead_id",
}
const STREAM_COLUMNS: Readonly<Record<string, string>> = {
  seat_placements: "stream_id",
  stream_requests: "resolved_by_stream_id",
}

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

// Reads a lead's history. Needs audit.view, which only the Super Admin
// holds (#237).
export async function getLeadHistory(
  supabase: SupabaseClient,
  leadId: string,
): Promise<Result<LeadHistory, LeadHistoryError>> {
  const { data, error } = await supabase.rpc("lead_history", { lead_id: leadId })
  if (error) {
    // Refused by the function, or by the grant for visitors not signed in.
    if (error.message === "forbidden" || error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    // A malformed id is a missing lead, not an outage.
    if (error.message === "not_found" || error.code === "22P02") return { ok: false, error: "not-found" }
    console.error("Could not read a lead's history", error)
    return { ok: false, error: "unavailable" }
  }

  const entries = ((data ?? []) as LeadHistoryRow[]).map(toEntry)

  const contactIds = new Set<string>()
  const leadIds = new Set<string>()
  const streamIds = new Set<string>()
  for (const entry of entries) {
    if (entry.record === "contact" && entry.recordId) contactIds.add(entry.recordId)
    for (const change of entry.changes) {
      const ids = CONTACT_COLUMNS.includes(change.field)
        ? contactIds
        : LEAD_COLUMNS[entry.record ?? ""] === change.field
          ? leadIds
          : STREAM_COLUMNS[entry.record ?? ""] === change.field
            ? streamIds
            : null
      if (!ids) continue
      for (const value of [change.from, change.to]) if (typeof value === "string") ids.add(value)
    }
  }

  const [contactNames, leadNames, streams] = await Promise.all([
    readNames<{ full_name: string }>(supabase, "guardian_contacts", "id, full_name", [...contactIds], (row) => row.full_name),
    readNames<{ student_name: string; admission_number: string }>(
      supabase,
      "leads",
      "id, student_name, admission_number",
      [...leadIds],
      (row) => `${row.student_name} · ${row.admission_number}`,
    ),
    readNames<{ class_name: LeadClass; label: string | null; takes: StreamTakes; opened_at: string }, { name: string; openedAt: string }>(
      supabase,
      "streams",
      "id, class_name, label, takes, opened_at",
      [...streamIds],
      (row) => ({ name: streamName(row.class_name, row.label ?? "", row.takes), openedAt: row.opened_at }),
    ),
  ])
  // A stream deleted since (owner 2026-11-26) keeps its name, marked deleted,
  // and when it opened.
  const gone = [...streamIds].filter((id) => !(id in streams))
  if (gone.length > 0) Object.assign(streams, await deletedStreamNames(supabase, gone))
  const streamNames = Object.fromEntries(Object.entries(streams).map(([id, stream]) => [id, stream.name]))
  const streamOpenedAt = Object.fromEntries(Object.entries(streams).map(([id, stream]) => [id, stream.openedAt]))
  return { ok: true, data: { entries, contactNames, leadNames, streamNames, streamOpenedAt } }
}

// Ids per request, so a long history never makes one oversized URL. The ids
// come only from this lead's own entries, each read once.
const NAMES_PER_REQUEST = 100

/**
 * "STD 1 B (deleted)" and when it opened, for each deleted stream among `ids`,
 * from its delete row in the audit log. Missing on any failure: the history
 * then shows the id, as for any name it can't read.
 */
async function deletedStreamNames(supabase: SupabaseClient, ids: string[]): Promise<Record<string, { name: string; openedAt: string }>> {
  const names: Record<string, { name: string; openedAt: string }> = {}
  for (let start = 0; start < ids.length; start += NAMES_PER_REQUEST) {
    const { data, error } = await supabase.rpc("deleted_stream_names", { ids: ids.slice(start, start + NAMES_PER_REQUEST) })
    if (error) {
      console.error("Could not read the names of deleted streams", error)
      return names
    }
    for (const row of (data ?? []) as { id: string; class_name: LeadClass; label: string | null; takes: StreamTakes; opened_at: string }[]) {
      if (!ids.includes(row.id) || typeof row.class_name !== "string") continue
      names[row.id] = { name: `${streamName(row.class_name, row.label ?? "", row.takes)} (deleted)`, openedAt: row.opened_at }
    }
  }
  return names
}

// The current name of each contact, sibling or stream (a stream's with when
// it was opened). The names only decorate the history, so a batch that can't
// be read leaves those unnamed (the screen shows their ids) rather than
// hiding the history.
async function readNames<Row, Name = string>(
  supabase: SupabaseClient,
  table: "guardian_contacts" | "leads" | "streams",
  columns: string,
  ids: string[],
  name: (row: Row) => Name,
): Promise<Record<string, Name>> {
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += NAMES_PER_REQUEST) batches.push(ids.slice(i, i + NAMES_PER_REQUEST))

  const results = await Promise.all(batches.map((batch) => supabase.from(table).select(columns).in("id", batch)))

  const names: Record<string, Name> = {}
  for (const { data, error } of results) {
    if (error) {
      console.error(`Could not read the ${table} a lead's history names`, error)
      continue
    }
    for (const row of data as unknown as (Row & { id: string })[]) names[row.id] = name(row)
  }
  return names
}
