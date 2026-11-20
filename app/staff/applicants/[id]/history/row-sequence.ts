import type { LeadHistoryEntry } from "@/lib/services/audit"

// One row's entries, oldest first, for each row of a table. Audit ids only
// grow, so an entry's id places it in that sequence.
export function rowSequences(entries: readonly LeadHistoryEntry[], record: string): ReadonlyMap<string, readonly LeadHistoryEntry[]> {
  const rows = new Map<string, LeadHistoryEntry[]>()
  for (const entry of [...entries].sort((a, b) => a.id - b.id)) {
    if (entry.record !== record || !entry.recordId) continue
    rows.set(entry.recordId, [...(rows.get(entry.recordId) ?? []), entry])
  }
  return rows
}

// The audit log keeps no transaction id. One save writes a row's entries a
// moment apart, by one actor, with no other entry of that row between them.
const ONE_SAVE_MS = 5_000

export function oneSave(earlier: LeadHistoryEntry, later: LeadHistoryEntry): boolean {
  return earlier.actor === later.actor && Math.abs(Date.parse(later.at) - Date.parse(earlier.at)) <= ONE_SAVE_MS
}
