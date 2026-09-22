import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

export type StaffSignInError = "invalid-credentials" | "not-on-allowlist" | "unavailable"
export type StaffUserError = "signed-out" | "not-on-allowlist" | "unavailable"

// Auth errors that mean "these credentials will not do", as opposed to a
// service problem. Anything else is reported as an outage so a staff member
// is never told their password is wrong when it is not.
const CREDENTIAL_ERROR_CODES = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "user_not_found",
  "user_banned",
])

// Whether the signed-in user's email is on the staff allowlist. Fails closed:
// if the check cannot run, the answer is no.
async function isAllowlisted(supabase: SupabaseClient): Promise<Result<boolean, "unavailable">> {
  const { data, error } = await supabase.rpc("is_admin")
  if (error) return { ok: false, error: "unavailable" }
  return { ok: true, data: data === true }
}

export async function signInStaff(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<Result<{ email: string }, StaffSignInError>> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) {
    const code = (error as { code?: string }).code
    return { ok: false, error: code && CREDENTIAL_ERROR_CODES.has(code) ? "invalid-credentials" : "unavailable" }
  }

  // A valid password is not enough: the email must still be on the allowlist.
  // Anyone else, or anyone we cannot check, loses the session they were just given.
  const allowlisted = await isAllowlisted(supabase)
  if (!allowlisted.ok || !allowlisted.data) {
    await supabase.auth.signOut()
    return { ok: false, error: allowlisted.ok ? "not-on-allowlist" : "unavailable" }
  }

  return { ok: true, data: { email } }
}

// The staff member behind the current session, checked against the
// allowlist on every call so removing an email takes effect immediately.
export async function getStaffUser(
  supabase: SupabaseClient,
): Promise<Result<{ email: string }, StaffUserError>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: "signed-out" }

  const allowlisted = await isAllowlisted(supabase)
  if (!allowlisted.ok) return { ok: false, error: "unavailable" }
  if (!allowlisted.data) return { ok: false, error: "not-on-allowlist" }

  return { ok: true, data: { email: user.email } }
}

export async function exchangeEmailLinkCode(
  supabase: SupabaseClient,
  code: string,
): Promise<Result<null, "invalid-link">> {
  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) return { ok: false, error: "invalid-link" }
  return { ok: true, data: null }
}

export async function signOutStaff(supabase: SupabaseClient): Promise<Result<null, "unavailable">> {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: "unavailable" }
  return { ok: true, data: null }
}
