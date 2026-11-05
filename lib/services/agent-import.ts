import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import {
  AGENT_IMPORT_COLUMNS,
  applyAgentVerdicts,
  classOfVerdict,
  screenAgentRows,
  type AgentImportRow,
  type AgentImportValues,
  type AgentVerdict,
} from "@/lib/agent-import"
import { readImportFile, type ImportFileError } from "@/lib/import"

import { UUID } from "./marketing-agents"
import type { Result } from "./result"

// Importing agents from a CSV (#190). The import module reads the file and
// runs the file's own checks; the database gives each remaining row its
// verdict against the agents stored, and confirm re-checks every verdict
// under one lock before writing anything. Needs agents.approve, which the
// database checks itself.

export type AgentImportCheck = { fileName: string; rows: AgentImportRow[] }

export type AgentImportError =
  | { kind: "file"; error: ImportFileError }
  | { kind: "forbidden" }
  // A value the database wouldn't store as sent, or rows that repeat one.
  | { kind: "invalid" }
  | { kind: "nothing-to-import" }
  // A creation outside the import took a value between the re-check and
  // the write, so nothing was saved.
  | { kind: "conflict" }
  | { kind: "unavailable" }
  // An error that may hide a saved import.
  | { kind: "uncertain" }

export type AgentImportOutcome =
  | { kind: "imported"; batchId: string; created: number; emailsAdded: number; skipped: number }
  // Every row, with those whose verdict changed since the check marked
  // `changed` and reclassified. Nothing was saved.
  | { kind: "changed"; rows: AgentImportRow[] }

export type AgentImportBatch = {
  id: string
  fileName: string
  importedAt: string
  // The staff member's name, looked up now.
  importedBy: string | null
  rowCount: number
  createdCount: number
  updatedCount: number
  skippedCount: number
}

type DbError = { message: string; code?: string; details?: string | null }
type DbAgent = { id: string; full_name: string; code: string; phone: string; email: string | null }
type DbVerdict = { verdict: AgentVerdict["verdict"]; agent?: DbAgent }

function verdictFromDb(row: DbVerdict): AgentVerdict {
  if (!row.agent) return { verdict: row.verdict } as AgentVerdict
  const { agent } = row
  return { verdict: row.verdict, agent: { id: agent.id, fullName: agent.full_name, code: agent.code, phone: agent.phone, email: agent.email } } as AgentVerdict
}

// The verdict as the database wrote it, for confirm to compare.
function verdictToDb(verdict: AgentVerdict): DbVerdict {
  if (!("agent" in verdict)) return { verdict: verdict.verdict }
  const { agent } = verdict
  return { verdict: verdict.verdict, agent: { id: agent.id, full_name: agent.fullName, code: agent.code, phone: agent.phone, email: agent.email } }
}

function rowArgs(row: { sheetRow: number; normalized: AgentImportValues }) {
  const values = row.normalized
  return { sheet_row: row.sheetRow, code: values.code, full_name: values.fullName, phone: values.mobile, whatsapp: values.whatsapp, email: values.email }
}

function refusal(error: DbError): AgentImportError | null {
  // 42501: the function isn't granted to the caller at all, as for someone signed out.
  if (error.message === "not_permitted" || error.code === "42501") return { kind: "forbidden" }
  if (error.message === "invalid") return { kind: "invalid" }
  if (error.message === "nothing_to_import") return { kind: "nothing-to-import" }
  if (["import_conflict", "code_taken", "retired_code", "email_taken"].includes(error.message)) return { kind: "conflict" }
  return null
}

// Reads an uploaded file and checks every row: the file's own checks, then
// the database's verdict on the rows that pass them. Saves nothing.
export async function checkAgentImportFile(
  supabase: SupabaseClient,
  fileName: string,
  bytes: Uint8Array,
): Promise<Result<AgentImportCheck, AgentImportError>> {
  const file = readImportFile(bytes, AGENT_IMPORT_COLUMNS)
  if (!file.ok) return { ok: false, error: { kind: "file", error: file.error } }
  const screened = screenAgentRows(file.data.rows)
  const candidates = screened.filter((row) => row.problem === null)

  const verdicts = new Map<number, AgentVerdict>()
  if (candidates.length > 0) {
    const { data, error } = await supabase.rpc("check_agent_import", { rows: candidates.map(rowArgs) })
    if (error) {
      const refused = refusal(error)
      if (refused) return { ok: false, error: refused }
      console.error("Could not check an agent import", error)
      return { ok: false, error: { kind: "unavailable" } }
    }
    for (const row of data as { sheet_row: number; verdict: DbVerdict }[]) verdicts.set(row.sheet_row, verdictFromDb(row.verdict))
  }
  return { ok: true, data: { fileName, rows: applyAgentVerdicts(screened, verdicts) } }
}

// Confirms a checked import, all or nothing. Every row the database checked
// is checked again under the import's lock; if any verdict changed, nothing
// is saved and the rows come back with the changed ones marked. Otherwise
// each new agent is created Approved by the Manager, with the batch, and
// each email to add is stored, confirmed by the Manager. Sends no email.
export async function confirmAgentImport(
  supabase: SupabaseClient,
  check: AgentImportCheck,
): Promise<Result<AgentImportOutcome, AgentImportError>> {
  const checked = check.rows.filter((row) => row.verdict !== null)
  const { data, error } = await supabase.rpc("confirm_agent_import", {
    file_name: check.fileName,
    row_count: check.rows.length,
    rows: checked.map((row) => ({ ...rowArgs(row), expected: verdictToDb(row.verdict!) })),
  })
  if (error) {
    const refused = refusal(error)
    if (refused) return { ok: false, error: refused }
    console.error("Could not confirm an agent import", error)
    return { ok: false, error: { kind: "uncertain" } }
  }
  const answer = data as
    | { outcome: "imported"; batch_id: string; created: number; emails_added: number; skipped: number }
    | { outcome: "changed"; rows: { sheet_row: number; verdict: DbVerdict }[] }
  if (answer.outcome === "imported") {
    return {
      ok: true,
      data: { kind: "imported", batchId: answer.batch_id, created: answer.created, emailsAdded: answer.emails_added, skipped: answer.skipped },
    }
  }
  const now = new Map(answer.rows.map((row) => [row.sheet_row, verdictFromDb(row.verdict)]))
  return {
    ok: true,
    data: {
      kind: "changed",
      rows: check.rows.map((row) => {
        const verdict = now.get(row.sheetRow)
        if (!verdict) return { ...row, changed: false }
        return { ...row, ...classOfVerdict(verdict), verdict, changed: true }
      }),
    },
  }
}

type BatchRow = {
  id: string
  file_name: string
  imported_at: string
  row_count: number
  created_count: number
  updated_count: number
  skipped_count: number
}

const BATCH_COLUMNS = "id, file_name, imported_at, row_count, created_count, updated_count, skipped_count"

// The batches with who ran each, by name, looked up now.
async function withImporters(supabase: SupabaseClient, rows: BatchRow[]): Promise<Result<AgentImportBatch[], "unavailable">> {
  const names = new Map<string, string>()
  if (rows.length > 0) {
    const read = await supabase.rpc("import_batch_importers", { batch_ids: rows.map((row) => row.id) })
    if (read.error) {
      console.error("Could not read who ran the agent imports", read.error)
      return { ok: false, error: "unavailable" }
    }
    for (const row of read.data as { batch_id: string; importer_name: string }[]) names.set(row.batch_id, row.importer_name)
  }
  return {
    ok: true,
    data: rows.map((row) => ({
      id: row.id,
      fileName: row.file_name,
      importedAt: row.imported_at,
      importedBy: names.get(row.id) ?? null,
      rowCount: row.row_count,
      createdCount: row.created_count,
      updatedCount: row.updated_count,
      skippedCount: row.skipped_count,
    })),
  }
}

// The latest agent imports, newest first. Staff without leads.view read none.
export async function listAgentImports(supabase: SupabaseClient, limit = 20): Promise<Result<AgentImportBatch[], "unavailable">> {
  const { data, error } = await supabase
    .from("import_batches")
    .select(BATCH_COLUMNS)
    .eq("kind", "agents")
    .order("imported_at", { ascending: false })
    .order("id")
    .limit(limit)
    .overrideTypes<BatchRow[], { merge: false }>()
  if (error) {
    console.error("Could not list the agent imports", error)
    return { ok: false, error: "unavailable" }
  }
  return withImporters(supabase, data)
}

// One agent import, or null when there is none the reader may see.
export async function getAgentImport(supabase: SupabaseClient, id: string): Promise<Result<AgentImportBatch | null, "unavailable">> {
  if (!UUID.test(id)) return { ok: true, data: null }
  const { data, error } = await supabase
    .from("import_batches")
    .select(BATCH_COLUMNS)
    .eq("kind", "agents")
    .eq("id", id)
    .maybeSingle()
    .overrideTypes<BatchRow | null, { merge: false }>()
  if (error) {
    console.error("Could not read an agent import", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: true, data: null }
  const named = await withImporters(supabase, [data])
  return named.ok ? { ok: true, data: named.data[0] } : named
}
