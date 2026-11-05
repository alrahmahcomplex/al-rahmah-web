"use server"

import { redirect } from "next/navigation"

import { signInAgent, type AgentSignInError } from "@/lib/services/agent-auth"
import { createClient } from "@/utils/supabase/server"

export type AgentSignInState = { error: AgentSignInError } | null

export async function signInToDiscountCode(_previous: AgentSignInState, formData: FormData): Promise<AgentSignInState> {
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
  const password = String(formData.get("password") ?? "")
  if (!email || !password) return { error: "invalid-credentials" }

  const result = await signInAgent(await createClient(), email, password)
  if (!result.ok) return { error: result.error }

  redirect("/discount-code/students")
}
