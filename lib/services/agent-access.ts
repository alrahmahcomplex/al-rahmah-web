import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// The agent access switch (#188): one database setting, off from setup, that
// turns every agent path off at once. It changes only in the SQL editor or a
// migration; staff who view leads read it for the Agents screen banner.

export type AgentAccess = {
  enabled: boolean
  // ISO timestamp, or null while it has never changed since setup.
  changedAt: string | null
  changedBy: { kind: "system" } | { kind: "staff"; name: string } | null
}

export type AgentAccessError =
  // Signed out, an agent, or staff without leads.view.
  | "forbidden"
  | "unavailable"

type AccessRow = {
  enabled: boolean
  changed_at: string | null
  changed_by_kind: "staff" | "system" | null
  changed_by_name: string | null
}

export async function getAgentAccess(supabase: SupabaseClient): Promise<Result<AgentAccess, AgentAccessError>> {
  const { data, error } = await supabase.rpc("agent_access_status")
  if (error) {
    // 42501: the function isn't granted to the caller, as for someone signed out.
    if (error.message === "not_permitted" || error.code === "42501") return { ok: false, error: "forbidden" }
    console.error("Could not read the agent access switch", error)
    return { ok: false, error: "unavailable" }
  }
  const row = ((data ?? []) as AccessRow[])[0]
  if (!row) {
    console.error("The agent access switch has no settings row")
    return { ok: false, error: "unavailable" }
  }
  return {
    ok: true,
    data: {
      enabled: row.enabled,
      changedAt: row.changed_at,
      changedBy:
        row.changed_by_kind === "staff"
          ? { kind: "staff", name: row.changed_by_name ?? "A former staff member" }
          : row.changed_by_kind === "system"
            ? { kind: "system" }
            : null,
    },
  }
}
