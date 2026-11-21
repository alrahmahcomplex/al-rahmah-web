"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"

import { normalizeTanzanianMobile } from "@/lib/phone"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { currentSessionKind } from "@/lib/services/auth-session"
import { HOME } from "@/lib/services/sign-in"
import { checkResetNumber, requestResetSms, saveResetPassword, type SmsResetCheckError, type SmsResetSaveError } from "@/lib/services/sms-reset"
import { verifyTurnstile } from "@/lib/turnstile"
import { createClient } from "@/utils/supabase/server"
import { sessionlessAuthClient } from "@/utils/supabase/sms"

// "Umesahau nenosiri?" by mobile (#503 slice 2b, F1 to F3). The page decides
// email or mobile in the browser; every step here reads the number again.
//
// A browser already signed in, as anyone, is asked to sign out first, at F1
// and again at F2, as the reset email's page does: a right number would
// replace that session, and a shared office browser would then be the
// agent's in the staff member's tabs.

// Names the login F2 proved, so F3 saves the password for that login only,
// even if this browser signs in as someone else in between.
const PROVEN_COOKIE = "sms-reset-proven"

export type SmsRequestStatus = "sent" | "invalid-login" | "signed-in" | "check-pending" | "check-failed" | "rate-limited" | "unavailable"
export type SmsCheckError = SmsResetCheckError | "signed-in" | "check-pending" | "check-failed"

// "unavailable" when the session can't be read: nothing is sent then either.
async function signedInAlready(): Promise<boolean | null> {
  const session = await currentSessionKind(await createClient())
  return session.ok ? session.data !== "none" : null
}

// F1, and "Tuma tena" on F2. Supabase checks the Turnstile token itself
// (CAPTCHA protection on Auth), so it is passed on unchecked, as /auth does.
// The reply comes first and Auth is asked after it, as the email link goes
// out after its reply: a number with an account waits for the SMS hook, and
// the page must not take longer to answer for it. A token Supabase refuses
// is logged; the person sends again after the countdown, with a fresh token.
export async function requestSmsReset(rawPhone: string, captchaToken: string): Promise<{ status: SmsRequestStatus }> {
  const phone = normalizeTanzanianMobile(String(rawPhone))
  if (!phone) return { status: "invalid-login" }
  if (!captchaToken) return { status: "check-pending" }
  const signedIn = await signedInAlready()
  if (signedIn === null) return { status: "unavailable" }
  if (signedIn) return { status: "signed-in" }
  if ((await checkPublicFormLimit({ headers: await headers(), key: "agent-reset", subject: phone })) === "limited") {
    return { status: "rate-limited" }
  }
  const token = String(captchaToken)
  after(async () => {
    const sent = await requestResetSms(sessionlessAuthClient(), phone, token)
    if (!sent.ok) console.error(`Reset SMS: not asked (${sent.error})`)
  })
  return { status: "sent" }
}

// F2: the six digits, each check with its own Turnstile token, checked here:
// Auth's checks come from Vercel's addresses and share one per-address
// allowance with every invite and reset link, so no check reaches Auth
// without a person behind it. A right number signs this browser in.
export async function checkSmsReset(rawPhone: string, code: string, captchaToken: string): Promise<{ error: SmsCheckError } | { ok: true; proven: string }> {
  const phone = normalizeTanzanianMobile(String(rawPhone))
  if (!phone) return { error: "wrong-number" }
  if (!captchaToken) return { error: "check-pending" }
  const requestHeaders = await headers()
  const human = await verifyTurnstile({
    token: String(captchaToken),
    action: "agent-link",
    remoteIp: requestHeaders.get("x-real-ip"),
    hostname: requestHeaders.get("host"),
  })
  if (!human.ok) return { error: "check-failed" }
  const signedIn = await signedInAlready()
  if (signedIn === null) return { error: "unavailable" }
  if (signedIn) return { error: "signed-in" }
  if ((await checkPublicFormLimit({ headers: requestHeaders, key: "agent-reset-check", subject: phone })) === "limited") {
    return { error: "rate-limited" }
  }
  const checked = await checkResetNumber(await createClient(), phone, String(code))
  if (!checked.ok) return { error: checked.error }
  ;(await cookies()).set(PROVEN_COOKIE, checked.data.userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth",
    maxAge: 60 * 60,
  })
  return { ok: true, proven: checked.data.userId }
}

export type SmsPasswordState = { error: SmsResetSaveError | "password-mismatch" } | null

// F3: the new password, on the session F2 gave. Then the students page.
export async function saveSmsResetPassword(_previous: SmsPasswordState, formData: FormData): Promise<SmsPasswordState> {
  const password = String(formData.get("password") ?? "")
  if (password !== String(formData.get("confirm") ?? "")) return { error: "password-mismatch" }
  // The login this form's own F2 proved, which must also be the cookie's
  // and the session's: another reset in another tab changes those.
  const jar = await cookies()
  const proven = String(formData.get("proven") ?? "")
  const cookie = jar.get(PROVEN_COOKIE)?.value ?? null
  const saved = await saveResetPassword(await createClient(), password, proven && proven === cookie ? proven : null)
  if (!saved.ok) return { error: saved.error }
  jar.delete({ name: PROVEN_COOKIE, path: "/auth" })
  redirect(HOME.agent)
}
