"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { requestOrigin } from "@/lib/agent-registration"
import { MINIMUM_PASSWORD_LENGTH } from "@/lib/password"
import { portalOrigin } from "@/lib/site-hosts"
import {
  checkConfirmationNumber,
  createPhoneLogin,
  selfConfirmSms,
  sendConfirmationNumber,
  sendSelfConfirmInvite,
} from "@/lib/services/agent-self-confirm"
import { currentSessionKind, passwordSignIn } from "@/lib/services/auth-session"
import { readLinkLimits } from "@/lib/services/password-link-requests"
import { smsSender } from "@/lib/services/sms"
import { agentInviteSender } from "@/utils/supabase/admin"
import { createClient } from "@/utils/supabase/server"
import { smsClient } from "@/utils/supabase/sms"

import { WELCOME_COOKIE, WELCOME_MAX_AGE, WELCOME_PATH } from "./students/welcome"

// Self-confirm's steps (#503 slice 3), switched off until slice 4: the
// database answers "off" to every one of them until then. The attempt is
// bound to this browser by an httpOnly cookie holding a random token (the
// database keeps only its digest), so another browser can't use it.

import { browserToken } from "./self-confirm-browser"

export type NumberStatus =
  | { status: "sent"; masked: string | null; onRecord: boolean }
  | { status: "expired" | "locked" | "too-soon" | "limited" | "no-sms" | "unavailable" }

function mask(phone: string): string {
  // +255712345123 → 07•• ••• 123
  const local = `0${phone.slice(4)}`
  return `${local.slice(0, 2)}•• ••• ${local.slice(-3)}`
}

export async function sendSelfConfirmNumber(attempt: string): Promise<NumberStatus> {
  const supabase = smsClient()
  const browser = await browserToken(false)
  if (!supabase || !browser) return { status: "expired" }
  const sent = await sendConfirmationNumber(supabase, smsSender(), { attempt: String(attempt), browser }, selfConfirmSms)
  if (!sent.ok) return { status: "unavailable" }
  switch (sent.data.kind) {
    case "sent":
      // The mobile is shown only when it is the one typed (O-N9): otherwise
      // not even its masked digits leave the server.
      return { status: "sent", masked: sent.data.show ? mask(sent.data.phone) : null, onRecord: sent.data.onRecord }
    case "expired":
    case "off":
      return { status: "expired" }
    case "locked":
      return { status: "locked" }
    case "too_soon":
      return { status: "too-soon" }
    case "code_limited":
      return { status: "limited" }
    default:
      // No mobile, the budget used up, the mobile's limits, the provider:
      // email is the way on (E4).
      return { status: "no-sms" }
  }
}

export type CheckStatus = { status: "right"; phone: string } | { status: "wrong"; triesLeft: number } | { status: "expired" | "expired-number" | "locked" | "mobile-used" | "unavailable" }

export async function checkSelfConfirmNumber(attempt: string, digits: string): Promise<CheckStatus> {
  const supabase = smsClient()
  const browser = await browserToken(false)
  if (!supabase || !browser) return { status: "expired" }
  const checked = await checkConfirmationNumber(supabase, { attempt: String(attempt), browser, digits: String(digits) })
  if (!checked.ok) return { status: "unavailable" }
  switch (checked.data.kind) {
    case "right":
      // The mobile the agent has just proved, for the password step.
      return { status: "right", phone: checked.data.phone }
    case "wrong":
      return { status: "wrong", triesLeft: Math.max(0, checked.data.triesLeft) }
    case "expired_number":
      return { status: "expired-number" }
    case "locked":
      return { status: "locked" }
    case "mobile_in_use":
      return { status: "mobile-used" }
    default:
      return { status: "expired" }
  }
}

export type EmailStatus = { status: "sent"; email: string } | { status: "expired" | "limited" | "no-email" | "email-unusable" | "unavailable" }

export async function sendSelfConfirmEmail(attempt: string, email: string): Promise<EmailStatus> {
  const supabase = smsClient()
  const browser = await browserToken(false)
  if (!supabase || !browser) return { status: "expired" }
  const origin = requestOrigin(await headers())
  if (!origin) return { status: "unavailable" }
  const redirectTo = `${portalOrigin(origin)}/discount-code/set-password`
  const sent = await sendSelfConfirmInvite(
    supabase,
    agentInviteSender(),
    { attempt: String(attempt), browser, email: String(email), hourlyBudget: readLinkLimits().hourlyBudget },
    redirectTo,
  )
  if (!sent.ok) return { status: "unavailable" }
  switch (sent.data.kind) {
    case "sent":
      return { status: "sent", email: sent.data.email }
    case "code_limited":
      return { status: "limited" }
    case "no_email":
      return { status: "no-email" }
    case "email_unusable":
      return { status: "email-unusable" }
    case "not_sent":
    case "busy":
      return { status: "unavailable" }
    default:
      return { status: "expired" }
  }
}

export type FinishState = { error: "password-mismatch" | "password-too-short" | "expired" | "check-pending" | "staff-session" | "unavailable" } | null

// The password for a proven mobile: the phone login, then this browser
// signs in with it and lands on the students page's one-time welcome.
export async function finishSelfConfirm(_previous: FinishState, formData: FormData): Promise<FinishState> {
  const attempt = String(formData.get("attempt") ?? "")
  const phone = String(formData.get("phone") ?? "")
  const password = String(formData.get("password") ?? "")
  if (password !== String(formData.get("confirm") ?? "")) return { error: "password-mismatch" }
  if (password.length < MINIMUM_PASSWORD_LENGTH) return { error: "password-too-short" }
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "")
  if (!captchaToken) return { error: "check-pending" }
  const supabase = smsClient()
  const token = await browserToken(false)
  if (!supabase || !token) return { error: "expired" }
  // A staff member signed in here keeps their session: the agent's sign-in
  // would replace it. Sign out first, as the invite link's page asks.
  const browser = await createClient()
  const session = await currentSessionKind(browser)
  if (!session.ok) return { error: "unavailable" }
  if (session.data === "staff") return { error: "staff-session" }

  const made = await createPhoneLogin(supabase, { attempt, browser: token, phone, password }, MINIMUM_PASSWORD_LENGTH)
  if (!made.ok) return { error: made.error === "not-proven" ? "expired" : made.error === "password-too-short" ? "password-too-short" : "unavailable" }

  const signedIn = await passwordSignIn(browser, { phone: phone.startsWith("+") ? phone : `+${phone}` }, password, captchaToken)
  const jar = await cookies()
  // The browser token stays: it counts this browser's set-ups for the day.
  if (!signedIn.ok) redirect("/auth")
  // ".self": the welcome says the account is ready (O-N17).
  jar.set(WELCOME_COOKIE, `${made.data.userId}.self`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: WELCOME_PATH,
    maxAge: WELCOME_MAX_AGE,
  })
  redirect(WELCOME_PATH)
}
