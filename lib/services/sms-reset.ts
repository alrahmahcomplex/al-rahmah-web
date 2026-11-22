import type { SupabaseClient } from "@supabase/supabase-js"

import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import { withoutPlus } from "@/lib/phone"

import { getAgentUser, type AgentAccessError } from "./agent-auth"
import { verifiedUserId } from "./auth-session"
import type { Result } from "./result"

// A password reset by SMS (#503 slice 2b, prototype F1 to F3), for agents who
// sign in with their mobile. Supabase Auth makes, stores and expires the
// confirmation number; its Send SMS hook texts it (app/api/auth/send-sms).
//
// F1: ask for a number. Every outcome that might send gets the same reply,
//     so the page never says whether a number has an account.
// F2: check the number. A right one signs this browser in, as the reset
//     email's link does; only an agent's login may stay signed in.
// F3: save the new password on that session, and only for the login F2
//     proved: the browser may have signed in as someone else since.

export type SmsResetRequestError = "unavailable"

// Auth refusals that depend on whether the number has a login, or on how
// recently it was texted: all of them read as "sent", like a real send.
const SAME_AS_SENT = new Set([
  "otp_disabled",
  "signup_disabled",
  "user_not_found",
  "phone_provider_disabled",
  "over_sms_send_rate_limit",
  "sms_send_failed",
  "hook_timeout",
  "hook_timeout_after_retry",
  "hook_payload_over_size_limit",
  "hook_payload_invalid_content_type",
  "unexpected_failure",
])

// `supabase` holds the secret key, after the app has checked the Turnstile
// token itself: Auth then skips its own CAPTCHA check, so a request with a
// junk token never reaches Auth or counts against its per-address limits.
export async function requestResetSms(supabase: SupabaseClient, phone: string): Promise<Result<null, SmsResetRequestError>> {
  let error: { code?: string; status?: number; message?: string } | null
  try {
    // shouldCreateUser: false, always: an unknown number never gets a login.
    ;({ error } = await supabase.auth.signInWithOtp({ phone: withoutPlus(phone), options: { shouldCreateUser: false } }))
  } catch (thrown) {
    console.error("Reset SMS: Auth could not be reached", thrown)
    return { ok: false, error: "unavailable" }
  }
  if (!error) return { ok: true, data: null }
  // Anything else Auth says still gets "sent": an answer that differs would
  // tell a stranger something about the number. Unexpected ones are logged.
  if (!error.code || !SAME_AS_SENT.has(error.code)) console.error("Reset SMS: unexpected answer from Auth", error)
  return { ok: true, data: null }
}

export type SmsResetCheckError = "wrong-number" | "rate-limited" | "no-account" | Exclude<AgentAccessError, "not-agent"> | "unavailable"

// "unconfirmed": Auth took the number and signed this browser in, but the
// agent check couldn't be read. The session is kept, so a retry needs no
// second number (Auth has spent this one): see confirmResetSession.
export type Unconfirmed = { ok: false; error: "unconfirmed"; userId: string }

export async function checkResetNumber(
  supabase: SupabaseClient,
  phone: string,
  token: string,
): Promise<Result<{ userId: string }, SmsResetCheckError> | Unconfirmed> {
  if (!/^\d{6}$/.test(token)) return { ok: false, error: "wrong-number" }
  let answer: Awaited<ReturnType<SupabaseClient["auth"]["verifyOtp"]>>
  try {
    answer = await supabase.auth.verifyOtp({ phone: withoutPlus(phone), token, type: "sms" })
  } catch (thrown) {
    console.error("Reset SMS: Auth could not be reached", thrown)
    return { ok: false, error: "unavailable" }
  }
  const { data, error } = answer
  if (error || !data.user) {
    const status = (error as { status?: number } | null)?.status ?? 0
    if (status === 429 || error?.code === "over_request_rate_limit") return { ok: false, error: "rate-limited" }
    // Auth gives one answer for a wrong number and an expired one.
    if (status >= 400 && status < 500) return { ok: false, error: "wrong-number" }
    console.error("Reset SMS: could not check a number", error)
    return { ok: false, error: "unavailable" }
  }

  return agentOnly(supabase, data.user.id)
}

// Whether this browser is signed in as `provenUserId` by the number for
// `phone`: another tab's reset, for another mobile, never counts. null when
// the token can't be checked right now (its signing keys didn't load, say):
// an outage, which must not cost the agent the number already spent.
export async function sessionProvedBy(supabase: SupabaseClient, provenUserId: string, phone: string): Promise<boolean | null> {
  try {
    const { data, error } = await supabase.auth.getClaims()
    if (error) {
      // A 4xx is a missing, spent or bad session; anything else an outage.
      const status = (error as { status?: number }).status ?? 0
      if (status >= 400 && status < 500) return false
      console.error("Reset SMS: could not check the session token", error)
      return null
    }
    if (!data) return false
    return data.claims.sub === provenUserId && data.claims.phone === withoutPlus(phone)
  } catch (error) {
    console.error("Reset SMS: could not check the session token", error)
    return null
  }
}

// F2 again, after "unconfirmed": the same login, still signed in here by
// this mobile's number. Another outage keeps it unconfirmed, for a retry.
export async function confirmResetSession(
  supabase: SupabaseClient,
  provenUserId: string,
  phone: string,
): Promise<Result<{ userId: string }, SmsResetCheckError> | Unconfirmed> {
  const proved = await sessionProvedBy(supabase, provenUserId, phone)
  if (proved === null) return { ok: false, error: "unconfirmed", userId: provenUserId }
  if (!proved) return { ok: false, error: "wrong-number" }
  return agentOnly(supabase, provenUserId)
}

// Only an agent's login stays signed in. Staff logins carry no phone, but
// anyone else loses this browser's new session at once. An outage keeps it.
async function agentOnly(supabase: SupabaseClient, userId: string): Promise<Result<{ userId: string }, SmsResetCheckError> | Unconfirmed> {
  const agent = await getAgentUser(supabase)
  if (agent.ok) return { ok: true, data: { userId } }
  if (agent.error === "unavailable" || agent.error === "signed-out") return { ok: false, error: "unconfirmed", userId }
  await supabase.auth.signOut({ scope: "local" })
  return { ok: false, error: agent.error === "not-agent" ? "no-account" : agent.error }
}

export type SmsResetSaveError = "password-too-short" | "signed-out" | "password-not-saved" | Exclude<AgentAccessError, "not-agent" | "signed-out"> | "no-account" | "unavailable"

export async function saveResetPassword(
  supabase: SupabaseClient,
  password: string,
  provenUserId: string | null,
): Promise<Result<null, SmsResetSaveError>> {
  if (password.length < MINIMUM_PASSWORD_LENGTH) return { ok: false, error: "password-too-short" }
  if (!provenUserId) return { ok: false, error: "signed-out" }
  if ((await verifiedUserId(supabase)) !== provenUserId) return { ok: false, error: "signed-out" }

  // Rechecked here: the agent may have been switched off since F2. An
  // outage keeps the session, so the same form can be sent again.
  const agent = await getAgentUser(supabase)
  if (!agent.ok) {
    if (agent.error === "signed-out") return { ok: false, error: "signed-out" }
    if (agent.error === "unavailable") return { ok: false, error: "unavailable" }
    await supabase.auth.signOut({ scope: "local" })
    return { ok: false, error: agent.error === "not-agent" ? "no-account" : agent.error }
  }

  const { error } = await supabase.auth.updateUser({ password })
  if (error) {
    console.error("Reset SMS: could not save the new password", error)
    return { ok: false, error: "password-not-saved" }
  }
  return { ok: true, data: null }
}
