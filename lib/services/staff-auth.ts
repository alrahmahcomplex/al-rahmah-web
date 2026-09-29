import type { SupabaseClient } from "@supabase/supabase-js"

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

// Supabase's minimum_password_length. Checked before the token is used, so a
// short password never spends the invite.
export const MINIMUM_PASSWORD_LENGTH = 6

export type AcceptInviteError =
  | "password-too-short"
  | "invalid-link"
  | "password-not-saved"
  | StaffAccessError

// Accepts an invite from the /auth/confirm form. The page never touches the
// token on load, so an email link scanner opening the link can't use it up;
// only this submit does. Using the token confirms the account for good, so
// the password is set before the staff record is checked: someone deactivated
// before accepting is signed out, but keeps a password that works once they
// are reactivated, rather than being left confirmed with no password they
// know and no invite that can be resent.
//
// If the password can't be saved, the session the token gave is kept, and
// `alreadyVerified` lets the same browser try again with the same link: the
// token is spent by then, so the retry sets the password on that session.
export async function acceptInvite(
  supabase: SupabaseClient,
  tokenHash: string,
  password: string,
  { alreadyVerified = false }: { alreadyVerified?: boolean } = {},
): Promise<Result<StaffMember, AcceptInviteError>> {
  if (password.length < MINIMUM_PASSWORD_LENGTH) return { ok: false, error: "password-too-short" }

  if (alreadyVerified) {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { ok: false, error: "invalid-link" }
  } else {
    const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: "invite" })
    if (verifyError) {
      // A 4xx means the link itself will not do; anything else is an outage,
      // and the unspent link still works on a retry.
      const status = verifyError.status ?? 0
      if (status >= 400 && status < 500) return { ok: false, error: "invalid-link" }
      console.error("Could not check an invite link", verifyError)
      return { ok: false, error: "unavailable" }
    }
  }

  const { error: updateError } = await supabase.auth.updateUser({ password })
  if (updateError) {
    console.error("Accepted an invite but could not set the password", updateError)
    return { ok: false, error: "password-not-saved" }
  }

  const staff = await loadStaffMember(supabase)
  if (!staff.ok) await supabase.auth.signOut()
  return staff
}

export async function signOutStaff(supabase: SupabaseClient): Promise<Result<null, "unavailable">> {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: "unavailable" }
  return { ok: true, data: null }
}
