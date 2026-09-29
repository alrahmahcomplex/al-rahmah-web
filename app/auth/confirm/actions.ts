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

  // Names the link this browser has already used and the account it signed
  // in, when saving the password failed after that, so a retry with the same
  // link can finish the job for that account and no other.
  const jar = await cookies()
  const [verifiedToken, verifiedUserId] = (jar.get(VERIFIED_COOKIE)?.value ?? "").split(" ")
  const retrying = verifiedToken === tokenHash && Boolean(verifiedUserId)

  const supabase = await createClient()
  const result = await acceptInvite(supabase, tokenHash, password, retrying ? { verifiedUserId } : {})
  if (!result.ok) {
    if ("userId" in result) {
      jar.set(VERIFIED_COOKIE, `${tokenHash} ${result.userId}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/auth/confirm",
        maxAge: 60 * 60,
      })
    }
    // Any other failure keeps the cookie, so a retry that hit an outage can
    // run again. It expires with the hour, and only ever sets the password of
    // the account it names.
    return { error: result.error }
  }

  if (retrying) jar.delete({ name: VERIFIED_COOKIE, path: "/auth/confirm" })
  redirect("/staff")
}
