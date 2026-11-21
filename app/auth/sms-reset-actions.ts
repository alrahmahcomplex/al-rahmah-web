"use server"

import { cookies, headers } from "next/headers"
import { redirect } from "next/navigation"

import { normalizeTanzanianMobile } from "@/lib/phone"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { HOME } from "@/lib/services/sign-in"
import { checkResetNumber, requestResetSms, saveResetPassword, type SmsResetCheckError, type SmsResetSaveError } from "@/lib/services/sms-reset"
import { createClient } from "@/utils/supabase/server"

// "Umesahau nenosiri?" by mobile (#503 slice 2b, F1 to F3). The page decides
// email or mobile in the browser; every step here reads the number again.

// Names the login F2 proved, so F3 saves the password for that login only,
// even if this browser signs in as someone else in between.
const PROVEN_COOKIE = "sms-reset-proven"

export type SmsRequestStatus = "sent" | "invalid-login" | "check-pending" | "check-failed" | "rate-limited" | "unavailable"

// F1, and "Tuma tena" on F2. Supabase checks the Turnstile token itself
// (CAPTCHA protection on Auth), so it is passed on unchecked, as /auth does.
export async function requestSmsReset(rawPhone: string, captchaToken: string): Promise<{ status: SmsRequestStatus }> {
  const phone = normalizeTanzanianMobile(String(rawPhone))
  if (!phone) return { status: "invalid-login" }
  if (!captchaToken) return { status: "check-pending" }
  if ((await checkPublicFormLimit({ headers: await headers(), key: "agent-reset", subject: phone })) === "limited") {
    return { status: "rate-limited" }
  }
  const sent = await requestResetSms(await createClient(), phone, String(captchaToken))
  return { status: sent.ok ? "sent" : sent.error }
}

// F2: the six digits. A right number signs this browser in.
export async function checkSmsReset(rawPhone: string, token: string): Promise<{ error: SmsResetCheckError } | { ok: true }> {
  const phone = normalizeTanzanianMobile(String(rawPhone))
  if (!phone) return { error: "wrong-number" }
  if ((await checkPublicFormLimit({ headers: await headers(), key: "agent-reset-check", subject: phone })) === "limited") {
    return { error: "rate-limited" }
  }
  const checked = await checkResetNumber(await createClient(), phone, String(token))
  if (!checked.ok) return { error: checked.error }
  ;(await cookies()).set(PROVEN_COOKIE, checked.data.userId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/auth",
    maxAge: 60 * 60,
  })
  return { ok: true }
}

export type SmsPasswordState = { error: SmsResetSaveError | "password-mismatch" } | null

// F3: the new password, on the session F2 gave. Then the students page.
export async function saveSmsResetPassword(_previous: SmsPasswordState, formData: FormData): Promise<SmsPasswordState> {
  const password = String(formData.get("password") ?? "")
  if (password !== String(formData.get("confirm") ?? "")) return { error: "password-mismatch" }
  const jar = await cookies()
  const saved = await saveResetPassword(await createClient(), password, jar.get(PROVEN_COOKIE)?.value ?? null)
  if (!saved.ok) return { error: saved.error }
  jar.delete({ name: PROVEN_COOKIE, path: "/auth" })
  redirect(HOME.agent)
}
