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
