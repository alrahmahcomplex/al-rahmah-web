"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { checkPublicFormLimit } from "@/lib/rate-limit"
import { signInAgent, type AgentSignInError } from "@/lib/services/agent-auth"
import { createClient } from "@/utils/supabase/server"

export type AgentSignInState = { error: AgentSignInError } | null

// The rate limit comes first, on its own key per IP and email (only a hash
// of the email goes into the key), so agents sharing school Wi-Fi each get
// their own tries. A limited try never reaches Supabase and gets the "too
// many tries" message, not "wrong password".
export async function signInToDiscountCode(_previous: AgentSignInState, formData: FormData): Promise<AgentSignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  const password = String(formData.get("password") ?? "")
  if (!email || !password) return { error: "invalid-credentials" }

  if ((await checkPublicFormLimit({ headers: await headers(), key: "agent-sign-in", subject: email })) === "limited") {
    return { error: "rate-limited" }
  }

  const result = await signInAgent(await createClient(), email, password)
  if (!result.ok) return { error: result.error }

  redirect("/discount-code/students")
}
