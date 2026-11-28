import type { LeadHistoryEntry } from "@/lib/services/audit"
import type { SiblingFeeEditReason } from "@/lib/services/sibling-groups"
import { FEE_EDIT_REASONS } from "@/lib/sibling-sentences"

import { becauseText } from "./because"
import { collapseSaves, rowSequences } from "./row-sequence"

// A lead's sibling group, Sibling discount and Manual Sibling fee edits in its
// history (#428), for describe.ts. The owner approved these words in the
// History wording prototype (https://claude.ai/artifact/JM7ytTjshMVquXW7N7QPub).

const GROUP = "sibling_group_members"
const RESULT = "lead_sibling_results"
const EDIT = "sibling_fee_edits"

// Each table's fields in the order an entry lists them, with their labels.
// Labels are per table, so another table's `result` or `cause` keeps its own.
export const SIBLING_LABELS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  [GROUP]: { sibling_of_lead_id: "Sibling of", basis: "Counts as a sibling", cause: "Because" },
  [RESULT]: { result: "Sibling discount", source: "Decided by", cause: "Because" },
  // `result` here is the edit's old and new result as one change.
  [EDIT]: { value: "Set to", result: "Sibling discount", reason: "Reason", note: "Note" },
}

// What staff don't need: ids, the entry's own time, and what another line
// already says. The group itself is an id; "Sibling of" says who it is with.
// A Legacy member shows as "Decided by: The old family rule".
export const SIBLING_HIDDEN: Readonly<Record<string, ReadonlySet<string>>> = {
  [GROUP]: new Set(["lead_id", "group_id", "legacy", "joined_at", "updated_at", "sibling_choice_made"]),
  [RESULT]: new Set(["lead_id", "locked_result", "locked_at", "updated_at"]),
  // Each sibling whose fee the edit changed shows it in their own history;
  // the result's source shows on the Sibling discount entry beside it.
  [EDIT]: new Set(["request_id", "lead_id", "staff_id", "changes", "old_source", "new_source", "old_result", "new_result"]),
}

const BASES: Readonly<Record<string, string>> = {
  matched: "Yes: the fathers’ names match",
  typo_confirmed: "Yes: a typing mistake was confirmed",
  request_needed: "Not yet: needs a Sibling request",
  granted: "Yes: a Sibling request was granted",
  refused: "No: the Sibling request was refused",
}

const RESULTS: Readonly<Record<string, string>> = {
  ten: "10% off",
  full: "Full fee",
  none: "No Sibling discount",
}

const SOURCES: Readonly<Record<string, string>> = {
  auto: "The Sibling fee rule",
  locked: "Fixed at enrolment",
  manual: "Set by hand",
  legacy: "The old family rule",
  prior_sibling: "The Has a sibling already at Al-Rahmah box",
}

const EDIT_VALUES: Readonly<Record<string, string>> = {
  full: "Full fee",
  ten: "10% off",
  automatic: "Back to automatic",
}

export function isSiblingRecord(record: string | null): boolean {
  return record === GROUP || record === RESULT || record === EDIT
}

export function siblingLabel(record: string | null, field: string): string | null {
  return SIBLING_LABELS[record ?? ""]?.[field] ?? null
}

export function siblingHidden(record: string | null, field: string): boolean {
  return SIBLING_HIDDEN[record ?? ""]?.has(field) ?? false
}

// The field's place in its entry; null for a record this file doesn't know.
export function siblingOrder(record: string | null): readonly string[] | null {
  const labels = SIBLING_LABELS[record ?? ""]
  return labels ? Object.keys(labels) : null
}

// A sibling, by name and Admission Number, wherever a row points at one.
export function siblingOfValue(record: string | null, field: string, value: unknown, leadNames: Readonly<Record<string, string>>): string | null {
  if (field !== "sibling_of_lead_id" || (record !== GROUP && record !== "discount_requests") || typeof value !== "string") return null
  return leadNames[value] ?? null
}

// A field's value in words; null for any other field or record, and for an
// empty value, which reads "None".
export function siblingValue(record: string | null, field: string, value: unknown): string | null {
  if (!isSiblingRecord(record) || value === null || value === undefined) return null
  const word = String(value)
  if (field === "cause" && record !== EDIT) return becauseText(record === GROUP ? "group" : "result", value)
  if (record === GROUP && field === "basis") return BASES[word] ?? null
  if (field === "result") return RESULTS[word] ?? null
  if (record === RESULT && field === "source") return SOURCES[word] ?? null
  if (record === EDIT && field === "value") return EDIT_VALUES[word] ?? null
  if (record === EDIT && field === "reason") return FEE_EDIT_REASONS[word as SiblingFeeEditReason]?.en ?? null
  return null
}

// A fee edit keeps the result before and after; they read as one change.
export function withEditResult(entry: LeadHistoryEntry): LeadHistoryEntry {
  if (entry.record !== EDIT) return entry
  const before = entry.changes.find((c) => c.field === "old_result")?.to ?? null
  const after = entry.changes.find((c) => c.field === "new_result")?.to ?? null
  if (after === null) return entry
  return { ...entry, changes: [...entry.changes, { field: "result", from: before, to: after }] }
}

// Staff answering the sibling question at registration or check-in. The
// database saves it as a membership with no group (registration inserts one,
// check-in marks the existing one answered), then in the same save takes a
// child out of its Family's legacy group and links the children staff named
// a sibling of. One save reads as one entry of what it changed overall.
export function collapseGroupSaves(entries: readonly LeadHistoryEntry[]): LeadHistoryEntry[] {
  return collapseSaves(entries, GROUP, "updated_at", "last")
}

// An answer that left the child in no group reads as being in no sibling
// group: the entries (already collapsed) that only mark the answer.
export type SiblingChoices = { noGroup: ReadonlySet<number> }

export function siblingChoices(entries: readonly LeadHistoryEntry[]): SiblingChoices {
  const noGroup = new Set<number>()
  for (const row of rowSequences(entries, GROUP).values()) {
    // The row's group is unknown (undefined) until an entry shows it. The
    // first sibling groups were made before the history recorded them, so
    // such a membership has no insert here, and it may sit in a group no
    // entry names. Only a group known to be none reads as no sibling group.
    let group: unknown
    for (const entry of row) {
      const groupChange = entry.changes.find((c) => c.field === "group_id")
      const answered = entry.changes.some((c) => c.field === "sibling_choice_made" && c.to === true)
      if (entry.action === "update" && answered && !groupChange && group === null) noGroup.add(entry.id)
      if (entry.action === "insert" || groupChange) group = groupChange?.to ?? null
    }
  }
  return { noGroup }
}

export function siblingSummary(entry: LeadHistoryEntry, choices: SiblingChoices): string | null {
  const changed = new Map(entry.changes.map((c) => [c.field, c]))
  const insert = entry.action === "insert"

  if (entry.record === GROUP) {
    if (insert) return changed.get("group_id")?.to ? "added the applicant to a sibling group" : "recorded that the applicant is in no sibling group"
    if (entry.action !== "update") return entry.action
    const group = changed.get("group_id")
    if (group) {
      if (group.to === null) return "took the applicant out of their sibling group"
      return group.from === null ? "added the applicant to a sibling group" : "moved the applicant to another sibling group"
    }
    if (changed.get("legacy")?.to === false) return "moved the applicant from the old family rule to the Sibling fee rule"
    if (choices.noGroup.has(entry.id)) return "recorded that the applicant is in no sibling group"
    return "changed the applicant’s sibling group details"
  }

  if (entry.record === RESULT) {
    if (insert && !changed.get("locked_at")?.to) return "worked out the applicant’s Sibling discount"
    if (!insert && entry.action !== "update") return entry.action
    // Enrolment fixes the result by setting the lock, on a new row too (a
    // first enrolment with no result stored). A manual result keeps its
    // source under the lock, and a later Back to automatic turns the source
    // to locked without fixing anything new.
    if (changed.get("locked_at")?.to) return "fixed the applicant’s Sibling discount when they were Enrolled"
    return "changed the applicant’s Sibling discount"
  }

  if (entry.record === EDIT) return insert ? "changed the Sibling discount by hand" : entry.action
  return null
}
