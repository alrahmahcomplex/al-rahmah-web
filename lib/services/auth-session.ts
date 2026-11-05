import type { SupabaseClient } from "@supabase/supabase-js"

import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"

import type { Result } from "./result"

// The sign-in steps staff and Discount code accounts share (#191). Each side
// adds its own check on top: staff-auth.ts that the login belongs to an
// active staff member, agent-auth.ts that it belongs to a switched-on agent.

export type SignInFailure = "invalid-credentials" | "rate-limited" | "banned" | "unavailable"

// Auth errors that mean "these credentials will not do", as opposed to a
// service problem. Anything else is reported as an outage, so nobody is told
// their password is wrong when it is not.
const CREDENTIAL_ERROR_CODES = new Set(["invalid_credentials", "email_not_confirmed", "user_not_found"])

export function classifySignInError(error: { code?: string; status?: number }): SignInFailure {
  if (error.code === "user_banned") return "banned"
  if (error.status === 429 || error.code === "over_request_rate_limit") return "rate-limited"
  if (error.code && CREDENTIAL_ERROR_CODES.has(error.code)) return "invalid-credentials"
  return "unavailable"
}

export async function passwordSignIn(
  supabase: SupabaseClient,
  email: string,
  password: string,
): Promise<Result<null, SignInFailure>> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  if (!error) return { ok: true, data: null }
  const failure = classifySignInError(error as { code?: string; status?: number })
  if (failure === "unavailable") console.error("Sign-in failed", error)
  return { ok: false, error: failure }
}

// Who this browser is signed in as already. One account per browser: staff
// pages refuse while an agent is signed in, and agent pages while staff are,
// so a link is never spent on the wrong session. A login that belongs to
// nobody counts as nobody.
export type SessionKind = "none" | "staff" | "agent"

export async function currentSessionKind(supabase: SupabaseClient): Promise<Result<SessionKind, "unavailable">> {
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (!user) {
    // A 4xx is a missing or spent session; anything else is an outage.
    const status = (error as { status?: number } | null)?.status ?? 400
    if (error && !(status >= 400 && status < 500)) return { ok: false, error: "unavailable" }
    return { ok: true, data: "none" }
  }

  const staff = await supabase.rpc("current_staff_member").maybeSingle<{ id: string }>()
  if (staff.error) return { ok: false, error: "unavailable" }
  if (staff.data) return { ok: true, data: "staff" }

  const agent = await supabase.rpc("current_agent_account").maybeSingle<{ state?: unknown }>()
  if (agent.error) return { ok: false, error: "unavailable" }
  return { ok: true, data: typeof agent.data?.state === "string" ? "agent" : "none" }
}

export type LinkPasswordError = "password-too-short" | "invalid-link" | "password-not-saved" | "unavailable"

// An auth error whose answer won't change on a retry (a spent link, no
// session), as opposed to an outage.
function isDefinitive(error: { status?: number } | null) {
  const status = error?.status ?? 0
  return status >= 400 && status < 500
}

// Uses an emailed link's token and sets the password, for an invite (and,
// from #194, a reset). Only a submit calls this: the page never touches the
// token on load, so an email link scanner can't use it up.
//
// If the password can't be saved, the session the token gave is kept and the
// failure names that account. A retry with the same link passes it back as
// `verifiedUserId`: the token is spent by then, so the retry sets the password
// on the session, and only while that same account is the one signed in.
export async function spendLinkAndSetPassword(
  supabase: SupabaseClient,
  tokenHash: string,
  type: "invite" | "recovery",
  password: string,
  { verifiedUserId }: { verifiedUserId?: string } = {},
): Promise<Result<{ userId: string }, LinkPasswordError> | { ok: false; error: "password-not-saved"; userId: string }> {
  if (password.length < MINIMUM_PASSWORD_LENGTH) return { ok: false, error: "password-too-short" }

  let userId: string
  if (verifiedUserId) {
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser()
    if (!user && error && !isDefinitive(error)) {
      console.error("Could not check the session for a link retry", error)
      return { ok: false, error: "unavailable" }
    }
    if (!user || user.id !== verifiedUserId) return { ok: false, error: "invalid-link" }
    userId = user.id
  } else {
    const { data: verified, error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
    if (verifyError || !verified.user) {
      // A 4xx means the link itself will not do; anything else is an outage,
      // and the unspent link still works on a retry.
      if (isDefinitive(verifyError)) return { ok: false, error: "invalid-link" }
      console.error("Could not check an email link", verifyError)
      return { ok: false, error: "unavailable" }
    }
    userId = verified.user.id
  }

  const { error: updateError } = await supabase.auth.updateUser({ password })
  if (updateError) {
    console.error("Used an email link but could not set the password", updateError)
    return { ok: false, error: "password-not-saved", userId }
  }
  return { ok: true, data: { userId } }
}

export async function signOutSession(supabase: SupabaseClient): Promise<Result<null, "unavailable">> {
  const { error } = await supabase.auth.signOut()
  if (error) return { ok: false, error: "unavailable" }
  return { ok: true, data: null }
}
