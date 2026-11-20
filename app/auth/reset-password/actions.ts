"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { RESET_PATH, RESET_VERIFIED_COOKIE as VERIFIED_COOKIE, retryFor } from "@/lib/password-reset"
import { resetPasswordFromLink, type ResetPasswordError } from "@/lib/services/password-reset"
import { HOME } from "@/lib/services/sign-in"
import { createClient } from "@/utils/supabase/server"

export type ResetPasswordState = { error: ResetPasswordError | "password-mismatch" } | null

// The shared reset page's form (#265). Like the invite pages, the cookie
// names the link this browser already used and the account it signed in,
// when saving the password failed after that, so a retry with the same link
// can finish the job for that account and no other.
export async function resetPassword(_previous: ResetPasswordState, formData: FormData): Promise<ResetPasswordState> {
  const tokenHash = String(formData.get("token_hash") ?? "")
  const password = String(formData.get("password") ?? "")
  if (!tokenHash) return { error: "invalid-link" }
  if (password !== String(formData.get("confirm") ?? "")) return { error: "password-mismatch" }

  const jar = await cookies()
  const verifiedUserId = retryFor(jar.get(VERIFIED_COOKIE)?.value, tokenHash)
  const retrying = verifiedUserId !== null

  const result = await resetPasswordFromLink(await createClient(), tokenHash, password, retrying ? { verifiedUserId } : {})
  if (!result.ok) {
    if ("userId" in result) {
      jar.set(VERIFIED_COOKIE, `${tokenHash} ${result.userId}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: RESET_PATH,
        maxAge: 60 * 60,
      })
    }
    return { error: result.error }
  }

  if (retrying) jar.delete({ name: VERIFIED_COOKIE, path: RESET_PATH })
  redirect(HOME[result.data])
}
