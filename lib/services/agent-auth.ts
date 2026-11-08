import type { SupabaseClient } from "@supabase/supabase-js"

import { currentSessionKind, spendLinkAndSetPassword, type SignInFailure } from "./auth-session"
import { readWithClockRetry } from "./clock-retry"
import type { Result } from "./result"

// Signing in to the Discount code pages (#191): the shared steps in
// auth-session.ts plus the agent check, which reads the signed-in agent from
// the database on every request, so a switch-off or agent access going off
// applies at once.

export type AgentAccount = { fullName: string; code: string }

// Why a valid login still may not use the Discount code pages.
export type AgentAccessError =
  // The login is staff's, or nobody's.
  | "not-agent"
  | "switched-off"
  | "retired"
  | "access-off"
  | "unavailable"

export type AgentUserError = "signed-out" | AgentAccessError
// `staff-session`: this browser is signed in as staff, so it must sign out
// first (one account per browser).
export type AgentSignInError = SignInFailure | "staff-session" | AgentAccessError

const STATES: Record<string, AgentAccessError> = {
  switched_off: "switched-off",
  retired: "retired",
  access_off: "access-off",
  // A Pending agent never gets a login; if one did, it can't sign in.
  not_approved: "switched-off",
}

async function loadAgentAccount(supabase: SupabaseClient): Promise<Result<AgentAccount, AgentAccessError>> {
  const { data, error } = await readWithClockRetry(() =>
    supabase.rpc("current_agent_account").maybeSingle<{ state: string; full_name: string | null; code: string | null }>(),
  )
  if (error) {
    console.error("Could not read the signed-in Discount code account", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: false, error: "not-agent" }
  if (data.state === "active" && data.full_name && data.code) {
    return { ok: true, data: { fullName: data.full_name, code: data.code } }
  }
  return { ok: false, error: STATES[data.state] ?? "unavailable" }
}

export async function getAgentUser(supabase: SupabaseClient): Promise<Result<AgentAccount, AgentUserError>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "signed-out" }
  return loadAgentAccount(supabase)
}

export type AcceptAgentInviteError =
  | "password-too-short"
  | "invalid-link"
  | "password-not-saved"
  | "joined-unavailable"
  | "staff-session"
  | AgentAccessError

// Sets the password from the invite link, or (#194) from a reset link with
// `linkType: "recovery"`, then lands the agent signed in. A
// browser signed in as staff is refused before the token is touched, so the
// link still works once staff sign out. Like the staff invite, the password
// is kept even when the agent check then refuses: a switched-off agent who is
// switched back on can sign in with it.
export async function acceptAgentInvite(
  supabase: SupabaseClient,
  tokenHash: string,
  password: string,
  { verifiedUserId, linkType = "invite" }: { verifiedUserId?: string; linkType?: "invite" | "recovery" } = {},
): Promise<Result<AgentAccount, AcceptAgentInviteError> | { ok: false; error: "password-not-saved"; userId: string }> {
  const session = await currentSessionKind(supabase)
  if (!session.ok) return { ok: false, error: "unavailable" }
  if (session.data === "staff") return { ok: false, error: "staff-session" }

  const accepted = await spendLinkAndSetPassword(supabase, tokenHash, linkType, password, { verifiedUserId })
  if (!accepted.ok) return accepted

  const agent = await loadAgentAccount(supabase)
  if (agent.ok) return agent
  await supabase.auth.signOut()
  return { ok: false, error: agent.error === "unavailable" ? "joined-unavailable" : agent.error }
}
