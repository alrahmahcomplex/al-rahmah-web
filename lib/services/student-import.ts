import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import { readImportFile, type ImportFileError } from "@/lib/import"
import {
  STUDENT_IMPORT_COLUMNS,
  applyStudentVerdicts,
  rowToDb,
  screenStudentRows,
  verdictFromDb,
  verdictToDb,
  type DbStudentVerdict,
  type StudentImportConfirmation,
  type StudentImportRow,
  type StudentVerdict,
} from "@/lib/student-import"

import { UUID } from "./marketing-agents"
import type { Result } from "./result"

// Importing students from a CSV of the admissions workbook. The import module
// reads the file and lib/student-import runs the file's own checks; the
// database gives each remaining row its verdict against the leads and
// contacts stored, and confirm re-checks every verdict under one lock before
// writing anything. Needs leads.import, which the database checks itself.

export type StudentImportCheck = { fileName: string; rows: StudentImportRow[] }

export type StudentImportError =
  | { kind: "file"; error: ImportFileError }
  | { kind: "forbidden" }
  // A value the database wouldn't store as sent, or rows that repeat a
  // student.
  | { kind: "invalid" }
  | { kind: "nothing-to-import" }
  | { kind: "unavailable" }
  // An error that may hide a saved import.
  | { kind: "uncertain" }

export type StudentImportOutcome =
  | { kind: "imported"; batchId: string; created: number; joinedFamily: number; skipped: number }
  // The rows whose verdict changed since the check, with the verdict now.
  // Nothing was saved.
  | { kind: "changed"; changed: { sheetRow: number; verdict: StudentVerdict }[] }

export type StudentImportBatch = {
  id: string
  fileName: string
  importedAt: string
  // The staff member's name, looked up now.
  importedBy: string | null
  rowCount: number
  // Leads the import created, those that joined a family included.
  createdCount: number
  skippedCount: number
}

type DbError = { message: string; code?: string; details?: string | null }

function refusal(error: DbError): StudentImportError | null {
  // 42501: the function isn't granted to the caller at all, as for someone signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  if (error.message === "invalid") return { kind: "invalid" }
  if (error.message === "nothing_to_import") return { kind: "nothing-to-import" }
  return null
}

// Reads an uploaded file and checks every row: the file's own checks, then
// the database's verdict on the rows that pass them. Saves nothing. `today`
// is the school's date, yyyy-mm-dd; left out, it is read from the clock.
export async function checkStudentImportFile(
  supabase: SupabaseClient,
  fileName: string,
  bytes: Uint8Array,
  today?: string,
): Promise<Result<StudentImportCheck, StudentImportError>> {
  const file = readImportFile(bytes, STUDENT_IMPORT_COLUMNS)
  if (!file.ok) return { ok: false, error: { kind: "file", error: file.error } }
  const screened = screenStudentRows(file.data.rows, today)
  const candidates = screened.filter((row) => row.problem === null)

  const verdicts = new Map<number, StudentVerdict>()
  if (candidates.length > 0) {
    const { data, error } = await supabase.rpc("check_student_import", { rows: candidates.map(rowToDb) })
    if (error) {
      const refused = refusal(error)
      if (refused) return { ok: false, error: refused }
      console.error("Could not check a student import", error)
      return { ok: false, error: { kind: "unavailable" } }
    }
    for (const row of data as { sheet_row: number; verdict: DbStudentVerdict }[]) verdicts.set(row.sheet_row, verdictFromDb(row.verdict))
  }
  return { ok: true, data: { fileName, rows: applyStudentVerdicts(screened, verdicts) } }
}

// Confirms a checked import, all or nothing. Every row the database checked
// is checked again under the import's lock; if any verdict changed, nothing
// is saved and the rows come back with the changed ones marked. Otherwise
// each new lead is created with the batch, as the review showed it.
export async function confirmStudentImport(
  supabase: SupabaseClient,
  confirmation: StudentImportConfirmation,
): Promise<Result<StudentImportOutcome, StudentImportError>> {
  const { data, error } = await supabase.rpc("confirm_student_import", {
    file_name: confirmation.fileName,
    row_count: confirmation.rowCount,
    rows: confirmation.rows.map((row) => ({ ...rowToDb(row), expected: verdictToDb(row.verdict) })),
  })
  if (error) {
    const refused = refusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not confirm a student import", error)
    return { ok: false, error: { kind: "uncertain" } }
  }
  const answer = data as
    | { outcome: "imported"; batch_id: string; created: number; joined_family: number; skipped: number }
    | { outcome: "changed"; rows: { sheet_row: number; verdict: DbStudentVerdict }[] }
  if (answer.outcome === "imported") {
    return {
      ok: true,
      data: { kind: "imported", batchId: answer.batch_id, created: answer.created, joinedFamily: answer.joined_family, skipped: answer.skipped },
    }
  }
  return {
    ok: true,
    data: { kind: "changed", changed: answer.rows.map((row) => ({ sheetRow: row.sheet_row, verdict: verdictFromDb(row.verdict) })) },
  }
}

type BatchRow = {
  id: string
  file_name: string
  imported_at: string
  row_count: number
  created_count: number
  skipped_count: number
}

const BATCH_COLUMNS = "id, file_name, imported_at, row_count, created_count, skipped_count"

// One student import, with who ran it, or null when there is none the reader
// may see. For the Done step and the lead history's "Created by the workbook
// import" line. Staff without leads.view see none.
export async function getStudentImport(supabase: SupabaseClient, id: string): Promise<Result<StudentImportBatch | null, "unavailable">> {
  if (!UUID.test(id)) return { ok: true, data: null }
  const { data, error } = await supabase
    .from("import_batches")
    .select(BATCH_COLUMNS)
    .eq("kind", "students")
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<BatchRow | null, { merge: false }>()
  if (error) {
    console.error("Could not read a student import", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: true, data: null }
  const names = await supabase.rpc("import_batch_importers", { batch_ids: [data.id] })
  if (names.error) {
    console.error("Could not read who ran a student import", names.error)
    return { ok: false, error: "unavailable" }
  }
  const importer = (names.data as { batch_id: string; importer_name: string }[])[0]?.importer_name ?? null
  return {
    ok: true,
    data: {
      id: data.id,
      fileName: data.file_name,
      importedAt: data.imported_at,
      importedBy: importer,
      rowCount: data.row_count,
      createdCount: data.created_count,
      skippedCount: data.skipped_count,
    },
  }
}

// A lead's import marks, for the lead page and its history: the batch it
// came from (null when it was not imported) and whether its Enrolled is the
// import's, with no qualifying payment recorded yet.
export type LeadImportMark = { batch: StudentImportBatch | null; enrolledByImport: boolean }

export async function getLeadImportMark(supabase: SupabaseClient, leadId: string): Promise<Result<LeadImportMark, "not-found" | "unavailable">> {
  const lead = await supabase
    .from("leads")
    .select("import_batch_id, enrolled_by_import")
    .eq("id", leadId)
    .maybeSingle<{ import_batch_id: string | null; enrolled_by_import: boolean }>()
  if (lead.error?.code === "22P02") return { ok: false, error: "not-found" }
  if (lead.error) {
    console.error("Could not read a lead's import mark", lead.error)
    return { ok: false, error: "unavailable" }
  }
  if (!lead.data) return { ok: false, error: "not-found" }
  if (!lead.data.import_batch_id) return { ok: true, data: { batch: null, enrolledByImport: false } }
  const batch = await getStudentImport(supabase, lead.data.import_batch_id)
  if (!batch.ok) return batch
  return { ok: true, data: { batch: batch.data, enrolledByImport: lead.data.enrolled_by_import } }
}
