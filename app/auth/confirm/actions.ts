"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { acceptInvite, type AcceptInviteError } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

const VERIFIED_COOKIE = "invite-verified"

export type AcceptInviteState = { error: AcceptInviteError | "password-mismatch" } | null

export async function setInvitePassword(_previous: AcceptInviteState, formData: FormData): Promise<AcceptInviteState> {
  const tokenHash = String(formData.get("token_hash") ?? "")
  const password = String(formData.get("password") ?? "")
  if (!tokenHash) return { error: "invalid-link" }
  // Checked here, before the token is used, like the length.
  if (password !== String(formData.get("confirm") ?? "")) return { error: "password-mismatch" }

  // Names the link this browser has already used, when saving the password
  // failed after that, so a retry with the same link can finish the job.
  const jar = await cookies()
  const alreadyVerified = jar.get(VERIFIED_COOKIE)?.value === tokenHash

  const supabase = await createClient()
  const result = await acceptInvite(supabase, tokenHash, password, { alreadyVerified })
  if (!result.ok && result.error === "password-not-saved") {
    jar.set(VERIFIED_COOKIE, tokenHash, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/auth/confirm",
      maxAge: 60 * 60,
    })
  } else if (alreadyVerified) {
    jar.delete({ name: VERIFIED_COOKIE, path: "/auth/confirm" })
  }
  if (!result.ok) return { error: result.error }

  redirect("/staff")
}
