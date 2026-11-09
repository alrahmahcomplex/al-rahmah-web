"use server"

import { revalidatePath } from "next/cache"

import type { AgentImportConfirmation, AgentImportRow, AgentVerdict } from "@/lib/agent-import"
import { IMPORT_LIMITS } from "@/lib/import"
import { checkAgentImportFile, confirmAgentImport } from "@/lib/services/agent-import"
import { requirePermission } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

import { importErrorMessage, type ImportMessage } from "./messages"

// The agent import's two steps (#190). The database checks agents.approve
// itself; the check here only words a signed-out session's answer.

export type CheckUploadAnswer =
  | { status: "checked"; fileName: string; rows: AgentImportRow[] }
  | { status: "refused"; message: ImportMessage }

export type ConfirmAnswer =
  | { status: "imported"; batchId: string; created: number; emailsAdded: number; skipped: number }
  | { status: "changed"; changed: { sheetRow: number; verdict: AgentVerdict }[] }
  | { status: "refused"; message: ImportMessage }

async function approverClient() {
  const supabase = await createClient()
  const allowed = await requirePermission(supabase, "agents.approve")
  if (allowed.ok) return { ok: true as const, supabase }
  return { ok: false as const, error: allowed.error === "signed-out" || allowed.error === "unavailable" ? allowed.error : ("forbidden" as const) }
}

// Reads the uploaded file and checks every row. Saves nothing.
export async function checkAgentImportUpload(form: FormData): Promise<CheckUploadAnswer> {
  const file = form.get("file")
  if (!(file instanceof File) || file.name.trim() === "") return { status: "refused", message: importErrorMessage({ kind: "file", error: { kind: "empty" } }) }
  // Read no more than the limit allows.
  if (file.size > IMPORT_LIMITS.maxBytes) {
    return { status: "refused", message: importErrorMessage({ kind: "file", error: { kind: "too-large", maxBytes: IMPORT_LIMITS.maxBytes } }) }
  }
  const client = await approverClient()
  if (!client.ok) return { status: "refused", message: importErrorMessage({ kind: client.error }) }
  const fileName = file.name.trim().slice(0, 255)
  const result = await checkAgentImportFile(client.supabase, fileName, new Uint8Array(await file.arrayBuffer()))
  if (!result.ok) return { status: "refused", message: importErrorMessage(result.error) }
  return { status: "checked", fileName, rows: result.data.rows }
}

// The confirmation's shape, as the browser sent it. The database re-checks
// every value and verdict; this only keeps malformed input from reaching it.
function confirmationOf(input: unknown): AgentImportConfirmation | null {
  if (typeof input !== "object" || input === null) return null
  const { fileName, rowCount, rows } = input as Record<string, unknown>
  if (typeof fileName !== "string" || typeof rowCount !== "number" || !Array.isArray(rows) || rows.length > IMPORT_LIMITS.maxRows) return null
  const text = (value: unknown) => value === null || typeof value === "string"
  for (const row of rows as Record<string, unknown>[]) {
    if (typeof row !== "object" || row === null || typeof row.sheetRow !== "number") return null
    const values = row.normalized as Record<string, unknown> | null
    if (typeof values !== "object" || values === null) return null
    if (!["code", "fullName", "mobile", "whatsapp", "email"].every((key) => text(values[key]))) return null
    const verdict = row.verdict as Record<string, unknown> | null
    if (typeof verdict !== "object" || verdict === null || typeof verdict.verdict !== "string") return null
  }
  return input as AgentImportConfirmation
}

// Confirms the checked rows, all or nothing.
export async function confirmAgentImportRows(input: AgentImportConfirmation): Promise<ConfirmAnswer> {
  const confirmation = confirmationOf(input)
  if (!confirmation) return { status: "refused", message: importErrorMessage({ kind: "invalid" }) }
  const client = await approverClient()
  if (!client.ok) return { status: "refused", message: importErrorMessage({ kind: client.error }) }
  const result = await confirmAgentImport(client.supabase, confirmation)
  // An import adds Approved agents and fills in missing emails, so no count in
  // the navigation moves (nav-counts.ts). Only the agents list and this page
  // change.
  if (!result.ok) {
    if (result.error.kind === "uncertain") revalidatePath("/staff/agents", "layout")
    return { status: "refused", message: importErrorMessage(result.error) }
  }
  if (result.data.kind === "changed") return { status: "changed", changed: result.data.changed }
  revalidatePath("/staff/agents", "layout")
  const { batchId, created, emailsAdded, skipped } = result.data
  return { status: "imported", batchId, created, emailsAdded, skipped }
}
