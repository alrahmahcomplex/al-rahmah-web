"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { readSignInLogin } from "@/lib/phone"
import { checkPublicFormLimit } from "@/lib/rate-limit"
import { HOME, signIn as signInAnyone, type SignInError } from "@/lib/services/sign-in"
import { requestHostAudience } from "@/lib/site-hosts"
import { createClient } from "@/utils/supabase/server"

export type SignInState = { error: SignInError } | null

// The one sign-in form (#264). The rate limit comes first, on its own key per
// IP and email (only a hash of the email goes into the key), so people
// sharing school Wi-Fi each get their own tries. A limited try never reaches
// Supabase and gets the "too many tries" message, not "wrong password".
//
// The Turnstile token goes to Supabase, which checks it (#268). It is not
// checked here as well, because Cloudflare accepts a token only once. A form
// sent without one is answered before the limit counts it, and reaches
// nothing.
//
// The login is an email or, since #503, a Tanzanian mobile (lib/phone.ts).
// Something that is neither is answered at once and counts for nothing.
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const typed = String(formData.get("login") ?? "").trim()
  const password = String(formData.get("password") ?? "")
  if (!typed || !password) return { error: "invalid-credentials" }
  const login = readSignInLogin(typed)
  if (!login) return { error: "invalid-login" }
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "")
  if (!captchaToken) return { error: "check-pending" }

  // The limit's key holds the email or the mobile as stored, so 0712… and
  // +255712… count as one person.
  const requestHeaders = await headers()
  const subject = "email" in login ? login.email : login.phone
  if ((await checkPublicFormLimit({ headers: requestHeaders, key: "sign-in", subject })) === "limited") {
    return { error: "rate-limited" }
  }

  const audience = requestHostAudience(requestHeaders)
  const result = await signInAnyone(await createClient(), login, password, captchaToken, audience)
  if (!result.ok) {
    if (result.error === "wrong-host") return { error: "no-account" }
    return { error: result.error }
  }

  redirect(HOME[result.data])
}
