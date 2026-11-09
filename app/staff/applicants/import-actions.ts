"use server"

import { revalidatePath } from "next/cache"

import { IMPORT_LIMITS } from "@/lib/import"
import { requirePermission } from "@/lib/services/staff-auth"
import { checkStudentImportFile, confirmStudentImport, getStudentImport } from "@/lib/services/student-import"
import type { StudentImportConfirmation, StudentImportRow, StudentVerdict } from "@/lib/student-import"
import { createClient } from "@/utils/supabase/server"

import { importErrorMessage, type ImportMessage } from "./import-messages"

// The applicant import's two steps. The database checks leads.import itself;
// the check here only words a signed-out session's answer.

export type CheckUploadAnswer =
  | { status: "checked"; fileName: string; rows: StudentImportRow[] }
  | { status: "refused"; message: ImportMessage }

export type ConfirmAnswer =
  | {
      status: "imported"
      batchId: string
      created: number
      joinedFamily: number
      skipped: number
      importedAt: string
      importedBy: string | null
    }
  | { status: "changed"; changed: { sheetRow: number; verdict: StudentVerdict }[] }
  | { status: "refused"; message: ImportMessage }

async function importerClient() {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "leads.import")
  if (allowed.ok) return { ok: true as const, supabase }
  return { ok: false as const, error: allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : ("forbidden" as const) }
}

// Reads the uploaded file and checks every row. Saves nothing.
export async function checkStudentImportUpload(form: FormData): Promise<CheckUploadAnswer> {
  const file = form.get("file")
  if (!(file instanceof File) || file.name.trim() === "") return { status: "refused", message: importErrorMessage({ kind: "file", error: { kind: "empty" } }) }
  // Read no more than the limit allows.
  if (file.size > IMPORT_LIMITS.maxBytes) {
    return { status: "refused", message: importErrorMessage({ kind: "file", error: { kind: "too-large", maxBytes: IMPORT_LIMITS.maxBytes } }) }
  }
  const client = await importerClient()
  if (!client.ok) return { status: "refused", message: importErrorMessage({ kind: client.error }) }
  const fileName = file.name.trim().slice(0, 255)
  const result = await checkStudentImportFile(client.supabase, fileName, new Uint8Array(await file.arrayBuffer()))
  if (!result.ok) return { status: "refused", message: importErrorMessage(result.error) }
  return { status: "checked", fileName, rows: result.data.rows }
}

const VALUE_KEYS = [
  "studentName",
  "className",
  "enrollmentYear",
  "dayOrBoarding",
  "guardianName",
  "relationship",
  "relationshipDescription",
  "phone",
  "whatsapp",
  "visitDate",
  "discountCode",
  "status",
] as const

// The confirmation's shape, as the browser sent it. The database re-checks
// every value and verdict; this only keeps malformed input from reaching it.
function confirmationShape(input: unknown): StudentImportConfirmation | null {
  if (typeof input !== "object" || input === null) return null
  const { fileName, rowCount, rows } = input as Record<string, unknown>
  if (typeof fileName !== "string" || fileName.trim() === "" || fileName.length > 255) return null
  if (typeof rowCount !== "number" || !Number.isInteger(rowCount) || rowCount < 0 || rowCount > IMPORT_LIMITS.maxRows) return null
  if (!Array.isArray(rows) || rows.length > rowCount) return null
  const scalar = (value: unknown) => value === null || typeof value === "string" || typeof value === "number"
  for (const row of rows as unknown[]) {
    if (typeof row !== "object" || row === null) return null
    const { sheetRow, normalized, verdict } = row as Record<string, unknown>
    if (typeof sheetRow !== "number" || !Number.isInteger(sheetRow)) return null
    if (typeof normalized !== "object" || normalized === null) return null
    const values = normalized as Record<string, unknown>
    if (!VALUE_KEYS.every((key) => scalar(values[key])) || typeof values.preFormOne !== "boolean") return null
    if (typeof verdict !== "object" || verdict === null || typeof (verdict as Record<string, unknown>).verdict !== "string") return null
  }
  return input as StudentImportConfirmation
}

// Confirms the checked rows, all or nothing.
export async function confirmStudentImportRows(input: StudentImportConfirmation): Promise<ConfirmAnswer> {
  const confirmation = confirmationShape(input)
  if (!confirmation) return { status: "refused", message: importErrorMessage({ kind: "invalid" }) }
  const client = await importerClient()
  if (!client.ok) return { status: "refused", message: importErrorMessage({ kind: client.error }) }
  const result = await confirmStudentImport(client.supabase, confirmation)
  // An import adds leads with no follow-up, re-application or request, so no
  // count in the navigation moves (nav-counts.ts). Only the applicant pages
  // change.
  if (!result.ok) {
    if (result.error.kind === "uncertain") revalidatePath("/staff/applicants", "layout")
    return { status: "refused", message: importErrorMessage(result.error) }
  }
  if (result.data.kind === "changed") return { status: "changed", changed: result.data.changed }
  revalidatePath("/staff/applicants", "layout")
  const { batchId, created, joinedFamily, skipped } = result.data
  // Who and when, as the batch recorded them. The import is saved either
  // way, so a failed read only leaves the name out.
  const batch = await getStudentImport(client.supabase, batchId)
  const saved = batch.ok ? batch.data : null
  return {
    status: "imported",
    batchId,
    created,
    joinedFamily,
    skipped,
    importedAt: saved?.importedAt ?? new Date().toISOString(),
    importedBy: saved?.importedBy ?? null,
  }
}
