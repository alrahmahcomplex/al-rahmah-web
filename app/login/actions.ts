"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { checkPublicFormLimit } from "@/lib/rate-limit"
import { HOME, signIn as signInAnyone, type SignInError } from "@/lib/services/sign-in"
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
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  const password = String(formData.get("password") ?? "")
  if (!email || !password) return { error: "invalid-credentials" }
  const captchaToken = String(formData.get("cf-turnstile-response") ?? "")
  if (!captchaToken) return { error: "check-pending" }

  if ((await checkPublicFormLimit({ headers: await headers(), key: "sign-in", subject: email })) === "limited") {
    return { error: "rate-limited" }
  }

  const result = await signInAnyone(await createClient(), email, password, captchaToken)
  if (!result.ok) return { error: result.error }

  redirect(HOME[result.data])
}
