import type { SupabaseClient } from "@supabase/supabase-js"

import { getAgentUser, type AgentAccessError } from "./agent-auth"
import { spendLinkAndSetPassword, type LinkPasswordError } from "./auth-session"
import type { Result } from "./result"
import type { SignedInAs } from "./sign-in"
import { getStaffUser, type StaffAccessError } from "./staff-auth"

// The shared reset page (#265): Supabase has one recovery email for the
// project, so staff and agents land on the same page. The link's token is
// spent and the password saved first; then the database says whose login it
// is, as on /login, and the person lands on their own side. Anyone who may
// not use either side loses the session the link gave them. The new password
// is kept either way, so a staff member or agent who is switched back on can
// sign in with it.

export type ResetPasswordError =
  | LinkPasswordError
  | Exclude<StaffAccessError, "not-staff">
  | Exclude<AgentAccessError, "not-agent">
  // A login that is neither an active staff member's nor an agent's.
  | "no-account"

export async function resetPasswordFromLink(
  supabase: SupabaseClient,
  tokenHash: string,
  password: string,
  { verifiedUserId }: { verifiedUserId?: string } = {},
): Promise<Result<SignedInAs, ResetPasswordError> | { ok: false; error: "password-not-saved"; userId: string }> {
  const spent = await spendLinkAndSetPassword(supabase, tokenHash, "recovery", password, { verifiedUserId })
  if (!spent.ok) return spent

  const refused = async (error: ResetPasswordError): Promise<Result<SignedInAs, ResetPasswordError>> => {
    await supabase.auth.signOut()
    return { ok: false, error }
  }

  // Staff first, as /login decides it. Fails closed.
  const staff = await getStaffUser(supabase)
  if (staff.ok) return { ok: true, data: "staff" }
  if (staff.error !== "not-staff") return refused(staff.error === "signed-out" ? "unavailable" : staff.error)

  const agent = await getAgentUser(supabase)
  if (agent.ok) return { ok: true, data: "agent" }
  if (agent.error === "not-agent") return refused("no-account")
  return refused(agent.error === "signed-out" ? "unavailable" : agent.error)
}
