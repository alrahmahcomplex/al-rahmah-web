import type { SupabaseClient } from "@supabase/supabase-js"

import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import type { Permission } from "@/lib/permissions"

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
export type StaffSignInError = "invalid-credentials" | StaffAccessError
export type StaffUserError = "signed-out" | StaffAccessError

// Auth errors that mean "these credentials will not do", as opposed to a
// service problem. Anything else is reported as an outage so a staff member
// is never told their password is wrong when it is not.
const CREDENTIAL_ERROR_CODES = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_not_found",
  "user_banned",
])

type StaffMemberRow = {
  id: string
  full_name: string
  email: string
  active: boolean
  role_name: string
  permissions: Permission[]
}

// PostgREST caches its clock, and some releases let that cache fall more than
// its 30 seconds of allowed skew behind, so a token issued a moment ago is
// refused as "issued at future" (PostgREST issue #5196, fixed in v14.18 and
// v16.3). The token is fine; PostgREST re-checks it against a fresh clock on
// the next request, so one more read a second later settles it.
const CLOCK_CATCH_UP_MS = 1000

function isIssuedAtFuture(error: { code?: string; message?: string }) {
  return error.code === "PGRST303" && error.message === "JWT issued at future"
}

function readStaffRecord(supabase: SupabaseClient) {
  return supabase.rpc("current_staff_member").maybeSingle<StaffMemberRow>()
}

// The staff record behind the current session, read fresh from the database
// so a deactivation or a permission change applies on the next request.
// Fails closed: if the record cannot be read, the answer is no.
async function loadStaffMember(supabase: SupabaseClient): Promise<Result<StaffMember, StaffAccessError>> {
  let { data, error } = await readStaffRecord(supabase)
  if (error && isIssuedAtFuture(error)) {
    await new Promise((resolve) => setTimeout(resolve, CLOCK_CATCH_UP_MS))
    ;({ data, error } = await readStaffRecord(supabase))
  }
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
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    const code = (error as { code?: string }).code
    if (code && CREDENTIAL_ERROR_CODES.has(code)) return { ok: false, error: "invalid-credentials" }
    console.error("Staff sign-in failed", error)
    return { ok: false, error: "unavailable" }
  }

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
  | StaffAccessError

// An auth error whose answer won't change on a retry (a spent link, no
// session), as opposed to an outage.
function isDefinitive(error: { status?: number } | null) {
  const status = error?.status ?? 0
  return status >= 400 && status < 500
}

// Accepts an invite from the /auth/confirm form. The page never touches the
// token on load, so an email link scanner opening the link can't use it up;
// only this submit does. Using the token confirms the account for good, so
// the password is set before the staff record is checked: someone deactivated
// before accepting is signed out, but keeps a password that works once they
// are reactivated, rather than being left confirmed with no password they
// know and no invite that can be resent.
//
// If the password can't be saved, the session the token gave is kept and the
// failure names that account. A retry with the same link passes it back as
// `verifiedUserId`: the token is spent by then, so the retry sets the password
// on the session, and only while that same account is the one signed in.
export async function acceptInvite(
  supabase: SupabaseClient,
  tokenHash: string,
  password: string,
  { verifiedUserId }: { verifiedUserId?: string } = {},
): Promise<Result<StaffMember, AcceptInviteError> | { ok: false; error: "password-not-saved"; userId: string }> {
  if (password.length < MINIMUM_PASSWORD_LENGTH) return { ok: false, error: "password-too-short" }

  // The account the link signed in: from the retry's cookie once the token
  // is spent, otherwise from verifying the token.
  let userId: string
  if (verifiedUserId) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (!user && error && !isDefinitive(error)) {
      console.error("Could not check the session for an invite retry", error)
      return { ok: false, error: "unavailable" }
    }
    if (!user || user.id !== verifiedUserId) return { ok: false, error: "invalid-link" }
    userId = user.id
  } else {
    const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" })
    if (verifyError || !verified.user) {
      // A 4xx means the link itself will not do; anything else is an outage,
      // and the unspent link still works on a retry.
      if (isDefinitive(verifyError)) return { ok: false, error: "invalid-link" }
      console.error("Could not check an invite link", verifyError)
      return { ok: false, error: "unavailable" }
    }
    userId = verified.user.id
  }

  const { error: updateError } = await supabase.auth.updateUser({ password })
  if (updateError) {
    console.error("Accepted an invite but could not set the password", updateError)
    return { ok: false, error: "password-not-saved", userId }
  }

  const staff = await loadStaffMember(supabase)
  if (staff.ok) return staff
  await supabase.auth.signOut()
  // The password is saved, so the invite is done: an outage here means
  // signing in later, not opening the spent link again.
  return { ok: false, error: staff.error === "unavailable" ? "joined-unavailable" : staff.error }
}

export async function signOutStaff(supabase: SupabaseClient): Promise<Result<null, "unavailable">> {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: "unavailable" }
  return { ok: true, data: null }
}
