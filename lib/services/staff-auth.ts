import type { SupabaseClient } from "@supabase/supabase-js"

import type { Permission } from "@/lib/permissions"

import { currentSessionKind, passwordSignIn, signOutSession, spendLinkAndSetPassword, type SignInFailure } from "./auth-session"
import { readWithClockRetry } from "./clock-retry"
import type { Result } from "./result"

export type StaffMember = {
  id: string
  name: string
  email: string
  roleName: string
  permissions: Permission[]
}

// Why someone with a valid session still may not use the staff side.
export type StaffAccessError = "not-staff" | "deactivated" | "unavailable"
// `agent-session`: this browser is signed in to the Discount code pages, so
// it must sign out first (one account per browser).
export type StaffSignInError = SignInFailure | "agent-session" | StaffAccessError
export type StaffUserError = "signed-out" | StaffAccessError

type StaffMemberRow = {
  id: string
  full_name: string
  email: string
  active: boolean
  role_name: string
  permissions: Permission[]
}

function readStaffRecord(supabase: SupabaseClient) {
  return supabase.rpc("current_staff_member").maybeSingle<StaffMemberRow>()
}

// The staff record behind the current session, read fresh from the database
// so a deactivation or a permission change applies on the next request.
// Fails closed: if the record cannot be read, the answer is no.
async function loadStaffMember(supabase: SupabaseClient): Promise<Result<StaffMember, StaffAccessError>> {
  const { data, error } = await readWithClockRetry(() => readStaffRecord(supabase))
  if (error) {
    console.error("Could not read the signed-in staff member", error)
    return { ok: false, error: "unavailable" }
  }
  if (!data) return { ok: false, error: "not-staff" }
  if (!data.active) return { ok: false, error: "deactivated" }

  return {
    ok: true,
    data: {
      id: data.id,
      name: data.full_name,
      email: data.email,
      roleName: data.role_name,
      permissions: data.permissions,
    },
  }
}

export async function signInStaff(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<Result<StaffMember, StaffSignInError>> {
  // Checked first, so an agent's session is never swapped for a staff one
  // in the same browser without signing out.
  const session = await currentSessionKind(supabase)
  if (!session.ok) return { ok: false, error: "unavailable" }
  if (session.data === "agent") return { ok: false, error: "agent-session" }

  const signedIn = await passwordSignIn(supabase, email, password)
  if (!signedIn.ok) return signedIn

  // A valid password is not enough: the account must belong to an active
  // staff member. Anyone else, or anyone we cannot check, loses the session
  // they were just given.
  const staff = await loadStaffMember(supabase)
  if (!staff.ok) await supabase.auth.signOut()
  return staff
}

export async function getStaffUser(supabase: SupabaseClient): Promise<Result<StaffMember, StaffUserError>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "signed-out" }

  return loadStaffMember(supabase)
}

// The gate for staff pages and actions: the signed-in staff member, if their
// role holds the permission right now.
export async function requirePermission(
  supabase: SupabaseClient,
  permission: Permission,
): Promise<Result<StaffMember, StaffUserError | "forbidden">> {
  const staff = await getStaffUser(supabase)
  if (!staff.ok) return staff
  if (!staff.data.permissions.includes(permission)) return { ok: false, error: "forbidden" }
  return staff
}

export async function exchangeEmailLinkCode(
  supabase: SupabaseClient,
  code: string,
): Promise<Result<null, "invalid-link">> {
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return { ok: false, error: "invalid-link" }
  return { ok: true, data: null }
}

export type AcceptInviteError =
  | "password-too-short"
  | "invalid-link"
  | "password-not-saved"
  | "joined-unavailable"
  | "agent-session"
  | StaffAccessError

// Accepts an invite from the /auth/confirm form (shared steps in
// auth-session.ts). Using the token confirms the account for good, so the
// password is set before the staff record is checked: someone deactivated
// before accepting is signed out, but keeps a password that works once they
// are reactivated. A browser signed in as an agent is refused before the
// token is touched.
export async function acceptInvite(
  supabase: SupabaseClient,
  tokenHash: string,
  password: string,
  { verifiedUserId }: { verifiedUserId?: string } = {},
): Promise<Result<StaffMember, AcceptInviteError> | { ok: false; error: "password-not-saved"; userId: string }> {
  const session = await currentSessionKind(supabase)
  if (!session.ok) return { ok: false, error: "unavailable" }
  if (session.data === "agent") return { ok: false, error: "agent-session" }

  const accepted = await spendLinkAndSetPassword(supabase, tokenHash, "invite", password, { verifiedUserId })
  if (!accepted.ok) return accepted

  const staff = await loadStaffMember(supabase)
  if (staff.ok) return staff
  await supabase.auth.signOut()
  // The password is saved, so the invite is done: an outage here means
  // signing in later, not opening the spent link again.
  return { ok: false, error: staff.error === "unavailable" ? "joined-unavailable" : staff.error }
}

export const signOutStaff = signOutSession
