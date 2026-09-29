"use server"

import { redirect } from "next/navigation"

import { acceptInvite, type AcceptInviteError } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

export type AcceptInviteState = { error: AcceptInviteError | "password-mismatch" } | null

export async function setInvitePassword(_previous: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const tokenHash = String(formData.get("token_hash") ?? "")
  const password = String(formData.get("password") ?? "")
  if (!tokenHash) return { error: "invalid-link" }
  // Checked here, before the token is used, like the length.
  if (password !== String(formData.get("confirm") ?? "")) return { error: "password-mismatch" }

  const supabase = await createClient()
  const result = await acceptInvite(supabase, tokenHash, password)
  if (!result.ok) return { error: result.error }

  redirect("/staff")
}
