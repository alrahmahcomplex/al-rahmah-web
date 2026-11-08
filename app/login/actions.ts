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
export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  const password = String(formData.get("password") ?? "")
  if (!email || !password) return { error: "invalid-credentials" }

  if ((await checkPublicFormLimit({ headers: await headers(), key: "sign-in", subject: email })) === "limited") {
    return { error: "rate-limited" }
  }

  const result = await signInAnyone(await createClient(), email, password)
  if (!result.ok) return { error: result.error }

  redirect(HOME[result.data])
}
