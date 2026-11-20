import type { LeadHistoryChange, LeadHistoryEntry } from "@/lib/services/audit"

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

// The audit log keeps no transaction id, but every write to these rows sets
// its time column (`stamp`) to now(), which is the same all through one
// transaction. So a later write in the same save leaves the time unchanged,
// and its entry has no `stamp` change; a write in any later save changes it.
function sameSave(later: LeadHistoryEntry, stamp: string): boolean {
  return later.action === "update" && !later.changes.some((c) => c.field === stamp)
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

// One save that wrote a row several times, as one entry of what it changed
// overall: each field from its value before the save to its value after it.
// The cause is the first one written (why the save touched the row) or the
// last (where it left it), as the table reads best.
function netChange(run: readonly LeadHistoryEntry[], cause: "first" | "last"): LeadHistoryEntry {
  const last = run[run.length - 1]
  const fields = new Map<string, LeadHistoryChange>()
  for (const entry of run) {
    for (const c of entry.changes) {
      const before = fields.get(c.field)
      fields.set(c.field, before ? { ...before, to: c.to } : c)
    }
  }
  const causes = run.flatMap((e) => e.changes.filter((c) => c.field === "cause"))
  const why = cause === "first" ? causes[0] : causes[causes.length - 1]
  if (why) fields.set("cause", { field: "cause", from: causes[0].from, to: why.to })
  const insert = run[0].action === "insert"
  return {
    ...last,
    action: run[0].action,
    // A new row lists every field it holds; a change lists only what moved.
    changes: [...fields.values()].filter((c) => insert || c.field === "cause" || !same(c.from, c.to)),
  }
}

// The entries with each save's writes to one row of `record` read as one.
export function collapseSaves(
  entries: readonly LeadHistoryEntry[],
  record: string,
  stamp: string,
  cause: "first" | "last",
): LeadHistoryEntry[] {
  const replaced = new Map<number, LeadHistoryEntry>()
  const dropped = new Set<number>()
  for (const row of rowSequences(entries, record).values()) {
    let run: LeadHistoryEntry[] = []
    const close = () => {
      if (run.length > 1) {
        run.slice(0, -1).forEach((e) => dropped.add(e.id))
        replaced.set(run[run.length - 1].id, netChange(run, cause))
      }
    }
    for (const entry of row) {
      if (run.length > 0 && sameSave(entry, stamp)) run.push(entry)
      else {
        close()
        run = [entry]
      }
    }
    close()
  }
  return entries.filter((e) => !dropped.has(e.id)).map((e) => replaced.get(e.id) ?? e)
}
