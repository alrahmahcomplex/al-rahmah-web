import type { SupabaseClient } from "@supabase/supabase-js"

import type { Result } from "./result"

export type StaffSignInError = "invalid-credentials" | "not-on-allowlist" | "unavailable"

export async function signInStaff(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<Result<{ email: string }, StaffSignInError>> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) return { ok: false, error: "invalid-credentials" }

  // A valid password is not enough: the email must still be on the allowlist.
  // Anyone else, or anyone we cannot check, loses the session they were just given.
  const { data: isStaff, error: checkError } = await supabase.rpc("is_admin")
  if (checkError || isStaff !== true) {
    await supabase.auth.signOut()
    return { ok: false, error: checkError ? "unavailable" : "not-on-allowlist" }
  }

  return { ok: true, data: { email } }
}

export type StaffUserError = "signed-out" | "not-on-allowlist" | "unavailable"

// The staff member behind the current session, checked against the
// allowlist on every call so removing an email takes effect immediately.
export async function getStaffUser(
  supabase: SupabaseClient,
): Promise<Result<{ email: string }, StaffUserError>> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user?.email) return { ok: false, error: "signed-out" }

  const { data: isStaff, error } = await supabase.rpc("is_admin")
  if (error) return { ok: false, error: "unavailable" }
  if (isStaff !== true) return { ok: false, error: "not-on-allowlist" }

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
