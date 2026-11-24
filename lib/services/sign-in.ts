import type { SupabaseClient } from "@supabase/supabase-js"

import type { SignInLogin } from "@/lib/phone"
import { allowsSignedInAs, type HostAudience } from "@/lib/site-hosts"

import { getAgentUser, type AgentAccessError } from "./agent-auth"
import { passwordSignIn, type SignInFailure } from "./auth-session"
import type { Result } from "./result"
import { getStaffUser, type StaffAccessError } from "./staff-auth"

// The sign-in service (#264, #539). The password is checked first, then the
// database says who the login belongs to. On production each host signs in its
// own people (portal. takes staff, agents. takes Discount code holders); a
// right password on the wrong host ends only this browser's new session
// (scope: "local") and names the host to use instead. On localhost and
// Previews ("both") one site serves both sides. The staff and agent pages
// still check the role on every request, so this only picks where to land.

export type SignedInAs = "staff" | "agent"

export type SignInError =
  | SignInFailure
  | Exclude<StaffAccessError, "not-staff">
  | Exclude<AgentAccessError, "not-agent">
  // A valid login that is neither an active staff member's nor an agent's.
  | "no-account"
  // Neither an email nor a Tanzanian mobile was typed: nothing was sent.
  | "invalid-login"

export type WrongHostFailure = {
  ok: false
  error: "wrong-host"
  expected: Exclude<HostAudience, "both">
}

export type SignInOutcome = Result<SignedInAs, SignInError> | WrongHostFailure

export const HOME: Record<SignedInAs, string> = { staff: "/staff", agent: "/home" }

export type HostHome =
  | { kind: "home"; path: string }
  | { kind: "wrong-host"; expected: Exclude<HostAudience, "both"> }

export function homeFor(as: SignedInAs, audience: HostAudience = "both"): HostHome {
  if (allowsSignedInAs(audience, as)) return { kind: "home", path: HOME[as] }
  return { kind: "wrong-host", expected: as === "staff" ? "portal" : "agents" }
}

export async function signIn(
  supabase: SupabaseClient,
  login: SignInLogin,
  password: string,
  captchaToken: string,
  audience: HostAudience = "both",
): Promise<SignInOutcome> {
  // signInWithPassword replaces any session this browser already holds, so a
  // second login never sits on top of the first.
  const signedIn = await passwordSignIn(supabase, login, password, captchaToken)
  if (!signedIn.ok) return signedIn

  const refused = async (failure: { ok: false; error: SignInError } | WrongHostFailure, scope?: "local"): Promise<SignInOutcome> => {
    await supabase.auth.signOut(scope ? { scope } : undefined)
    return failure
  }

  // Staff first: a staff record decides it, active or not. Fails closed.
  // Staff sign in with their email only (#503, owner decision 76): a mobile
  // that reaches a staff login is refused like any other login with no place.
  // The database already keeps phones off staff logins (mobile_login_guards);
  // if one ever got through, only this browser's new session ends, not the
  // staff member's sessions on their other devices.
  const staff = await getStaffUser(supabase)
  if (staff.ok) {
    if (!("email" in login)) return refused({ ok: false, error: "no-account" }, "local")
    const target = homeFor("staff", audience)
    return target.kind === "home"
      ? { ok: true, data: "staff" }
      : refused({ ok: false, error: "wrong-host", expected: target.expected }, "local")
  }
  if (staff.error !== "not-staff") return refused({ ok: false, error: staff.error === "signed-out" ? "unavailable" : staff.error })

  const agent = await getAgentUser(supabase)
  // A waiting code's login signs in to see its code (#503 slice 4d-b).
  if (agent.ok || agent.error === "pending") {
    const target = homeFor("agent", audience)
    return target.kind === "home"
      ? { ok: true, data: "agent" }
      : refused({ ok: false, error: "wrong-host", expected: target.expected }, "local")
  }
  if (agent.error === "not-agent") return refused({ ok: false, error: "no-account" })
  return refused({ ok: false, error: agent.error === "signed-out" ? "unavailable" : agent.error })
}

export type SignedInHomeResult =
  | { kind: "none" }
  | { kind: "home"; path: string }
  | { kind: "wrong-host"; expected: Exclude<HostAudience, "both">; as: SignedInAs }

// Where /auth sends a browser that is already signed in, or "none" to show the
// form. Only a session that can use its side right now counts, so a
// deactivated staff member sent back here by /staff sees the reason instead
// of bouncing between the two pages. A session belonging to the other host
// returns "wrong-host" so /auth can handle it without redirecting into a loop.
export async function signedInHome(supabase: SupabaseClient, audience: HostAudience = "both"): Promise<SignedInHomeResult> {
  const staff = await getStaffUser(supabase)
  if (staff.ok) {
    const target = homeFor("staff", audience)
    return target.kind === "home" ? target : { ...target, as: "staff" }
  }
  if (staff.error !== "not-staff") return { kind: "none" }
  const agent = await getAgentUser(supabase)
  if (agent.ok || agent.error === "pending") {
    const target = homeFor("agent", audience)
    return target.kind === "home" ? target : { ...target, as: "agent" }
  }
  return { kind: "none" }
}
