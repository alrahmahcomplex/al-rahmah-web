import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

// Remove this sign-in (#503 slice 4a, prototype v58 R1 to R3): the office puts
// out someone who joined on an agent's code. Staff with agents.approve; the
// database checks it and does the whole removal in one step
// (20270126120100_agent_remove_sign_in.sql).

export type SignInRemovalError = "forbidden" | "not-found" | "retired" | "not-joined" | "unavailable"

function removalError(error: { message: string; code?: string }, what: string): SignInRemovalError {
  // 42501: the function isn't granted to the caller, as for someone signed out.
  if (error.message === "not_permitted" || error.code === "42501") return "forbidden"
  // A malformed id is no agent at all.
  if (error.message === "not_found" || error.code === "22P02") return "not-found"
  if (error.message === "retired") return "retired"
  if (error.message === "not_joined") return "not-joined"
  console.error(what, error)
  return "unavailable"
}

export type AgentSignIn = { signedInWith: string; joinedAt: string | null }

/** What the joined agent signs in with, and when they joined, for the sheet. */
export async function getAgentSignIn(supabase: SupabaseClient, agentId: string): Promise<Result<AgentSignIn, SignInRemovalError>> {
  const { data, error } = await supabase.rpc("agent_sign_in", { agent_id: agentId })
  if (error) return { ok: false, error: removalError(error, "Could not read an agent's sign-in") }
  const row = (data as { signed_in_with: string; joined_at: string | null }[] | null)?.[0]
  if (!row) return { ok: false, error: "not-joined" }
  return { ok: true, data: { signedInWith: row.signed_in_with, joinedAt: row.joined_at } }
}

/**
 * Removes the joined agent's sign-in: signed out everywhere (the Auth user
 * and its sessions are deleted), not joined, open self-confirm attempts void.
 * `closeEmail`: the sheet's tick, closing email self-confirm on the code
 * until the real agent joins. A lost answer may hide a removal that happened.
 */
export async function removeAgentSignIn(
  supabase: SupabaseClient,
  agentId: string,
  closeEmail: boolean,
): Promise<Result<{ signedInWith: string }, SignInRemovalError | "uncertain">> {
  const { data, error } = await supabase.rpc("remove_agent_sign_in", { agent_id: agentId, close_email: closeEmail })
  if (error) {
    const refused = removalError(error, "Could not remove an agent's sign-in")
    return { ok: false, error: refused === "unavailable" ? "uncertain" : refused }
  }
  const row = data as { signed_in_with?: unknown } | null
  return { ok: true, data: { signedInWith: typeof row?.signed_in_with === "string" ? row.signed_in_with : "" } }
}

export type SignInRemovalNote = { removedAt: string; removedBy: string | null; closeEmail: boolean }

/** The latest removal for each listed agent who isn't joined now. */
export async function getSignInRemovals(supabase: SupabaseClient, agentIds: string[]): Promise<Result<Map<string, SignInRemovalNote>, "unavailable">> {
  if (agentIds.length === 0) return { ok: true, data: new Map() }
  const { data, error } = await supabase.rpc("agent_sign_in_removals", { agent_ids: agentIds })
  if (error) {
    console.error("Could not read the agents' removed sign-ins", error)
    return { ok: false, error: "unavailable" }
  }
  const rows = (data as { agent_id: string; removed_at: string; removed_by: string | null; close_email: boolean }[] | null) ?? []
  return { ok: true, data: new Map(rows.map((row) => [row.agent_id, { removedAt: row.removed_at, removedBy: row.removed_by, closeEmail: row.close_email }])) }
}
