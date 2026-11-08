import type { SupabaseClient } from "@supabase/supabase-js"

import { getAgentUser, type AgentAccessError } from "./agent-auth"
import { passwordSignIn, type SignInFailure } from "./auth-session"
import type { Result } from "./result"
import { getStaffUser, type StaffAccessError } from "./staff-auth"

// The one sign-in page (#264) for staff and Discount code holders. The
// password is checked first, then the database says who the login belongs
// to: an active staff member goes to the staff side, a switched-on agent to
// the Discount code pages. Anyone else loses the session they were just
// given. The staff and agent pages still check the role on every request, so
// this only picks where to land.

export type SignedInAs = "staff" | "agent"

export type SignInError =
  | SignInFailure
  | Exclude<StaffAccessError, "not-staff">
  | Exclude<AgentAccessError, "not-agent">
  // A valid login that is neither an active staff member's nor an agent's.
  | "no-account"

export const HOME: Record<SignedInAs, string> = { staff: "/staff", agent: "/discount-code/students" }

export async function signIn(supabase: SupabaseClient, email: string, password: string): Promise<Result<SignedInAs, SignInError>> {
  // signInWithPassword replaces any session this browser already holds, so a
  // second login never sits on top of the first.
  const signedIn = await passwordSignIn(supabase, email, password)
  if (!signedIn.ok) return signedIn

  const refused = async (error: SignInError): Promise<Result<SignedInAs, SignInError>> => {
    await supabase.auth.signOut()
    return { ok: false, error }
  }

  // Staff first: a staff record decides it, active or not. Fails closed.
  const staff = await getStaffUser(supabase)
  if (staff.ok) return { ok: true, data: "staff" }
  if (staff.error !== "not-staff") return refused(staff.error === "signed-out" ? "unavailable" : staff.error)

  const agent = await getAgentUser(supabase)
  if (agent.ok) return { ok: true, data: "agent" }
  if (agent.error === "not-agent") return refused("no-account")
  return refused(agent.error === "signed-out" ? "unavailable" : agent.error)
}

// Where /login sends a browser that is already signed in, or null to show the
// form. Only a session that can use its side right now goes on, so a
// deactivated staff member sent back here by /staff sees the reason instead
// of bouncing between the two pages.
export async function signedInHome(supabase: SupabaseClient): Promise<string | null> {
  const staff = await getStaffUser(supabase)
  if (staff.ok) return HOME.staff
  if (staff.error !== "not-staff") return null
  const agent = await getAgentUser(supabase)
  return agent.ok ? HOME.agent : null
}
