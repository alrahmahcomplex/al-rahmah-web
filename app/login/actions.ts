"use server"

import { redirect } from "next/navigation"

import { signInStaff, type StaffSignInError } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

export type SignInState = { error: StaffSignInError } | null

export async function signIn(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase()
  const password = String(formData.get("password") ?? "")
  if (!email || !password) return { error: "invalid-credentials" }

  const supabase = await createClient()
  const result = await signInStaff(supabase, email, password)
  if (!result.ok) return { error: result.error }

  redirect("/staff")
}
