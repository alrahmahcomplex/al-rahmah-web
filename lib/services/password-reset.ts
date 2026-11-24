import type { SupabaseClient } from "@supabase/supabase-js"

import type { HostAudience } from "@/lib/site-hosts"

import { getAgentUser, type AgentAccessError } from "./agent-auth"
import { spendLinkAndSetPassword, type LinkPasswordError } from "./auth-session"
import type { Result } from "./result"
import { homeFor, type SignedInAs, type WrongHostFailure } from "./sign-in"
import { getStaffUser, type StaffAccessError } from "./staff-auth"

// The shared reset page (#265, #539): Supabase has one recovery email for the
// project, so staff and agents land on the same page on their own host. The
// link's token is spent and the password saved first; then the database says
// whose login it is, as on /auth. Anyone who may not use either side loses the
// session the link gave them. An old link opened on the wrong host still saves
// the password, signs out only this host's session (scope: "local"), and names
// the host to sign in on. The new password is kept either way.

export type ResetPasswordError =
  | LinkPasswordError
  | Exclude<StaffAccessError, "not-staff">
  | Exclude<AgentAccessError, "not-agent">
  // A login that is neither an active staff member's nor an agent's.
  | "no-account"

export type ResetPasswordOutcome =
  | Result<SignedInAs, ResetPasswordError>
  | { ok: false; error: "password-not-saved"; userId: string }
  | WrongHostFailure

export async function resetPasswordFromLink(
  supabase: SupabaseClient,
  tokenHash: string,
  password: string,
  { verifiedUserId, audience = "both" }: { verifiedUserId?: string; audience?: HostAudience } = {},
): Promise<ResetPasswordOutcome> {
  const spent = await spendLinkAndSetPassword(supabase, tokenHash, "recovery", password, { verifiedUserId })
  if (!spent.ok) return spent

  const refused = async (failure: { ok: false; error: ResetPasswordError } | WrongHostFailure, scope?: "local"): Promise<ResetPasswordOutcome> => {
    await supabase.auth.signOut(scope ? { scope } : undefined)
    return failure
  }

  // Staff first, as /auth decides it. Fails closed.
  const staff = await getStaffUser(supabase)
  if (staff.ok) {
    const target = homeFor("staff", audience)
    return target.kind === "home"
      ? { ok: true, data: "staff" }
      : refused({ ok: false, error: "wrong-host", expected: target.expected }, "local")
  }
  if (staff.error !== "not-staff") return refused({ ok: false, error: staff.error === "signed-out" ? "unavailable" : staff.error })

  const agent = await getAgentUser(supabase)
  // A waiting code's login is the agent's own too (#503 slice 4d-b).
  if (agent.ok || agent.error === "pending") {
    const target = homeFor("agent", audience)
    return target.kind === "home"
      ? { ok: true, data: "agent" }
      : refused({ ok: false, error: "wrong-host", expected: target.expected }, "local")
  }
  if (agent.error === "not-agent") return refused({ ok: false, error: "no-account" })
  return refused({ ok: false, error: agent.error === "signed-out" ? "unavailable" : agent.error })
}
