import type { LeadHistoryEntry } from "@/lib/services/audit"

// A lead the student import created: its creation entry says so, naming the
// file, in place of the batch id the row carries. The import's own marks get
// plain labels.

// The batch id says nothing a person can read; the note names the file.
export const IMPORT_HIDDEN = "import_batch_id"

export const IMPORT_LABELS: Record<string, string> = {
  enrolled_by_import: "Enrolled by the import, payments not recorded",
  imported_as_enrolled: "Imported as Enrolled",
}

// "Created by the workbook import (<file>)" on the lead's creation entry, or
// nothing for every other entry. `fileName` is null when the batch can't be
// read.
export function importNote(entry: LeadHistoryEntry, fileName: string | null): string | undefined {
  if (entry.record !== "lead" || entry.action !== "insert") return undefined
  const batch = entry.changes.find((change) => change.field === "import_batch_id")?.to
  if (typeof batch !== "string" || batch === "") return undefined
  return fileName ? `Created by the workbook import (${fileName})` : "Created by the workbook import"
}
