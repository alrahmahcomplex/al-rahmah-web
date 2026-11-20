"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { acceptAgentInvite, type AcceptAgentInviteError } from "@/lib/services/agent-auth"
import { createClient } from "@/utils/supabase/server"

import { WELCOME_COOKIE, WELCOME_MAX_AGE, WELCOME_PATH } from "../students/welcome"

const PATH = "/discount-code/set-password"
const VERIFIED_COOKIE = "agent-invite-verified"

export type SetAgentPasswordState = { error: AcceptAgentInviteError | "password-mismatch" } | null

// The agent's set-password form, for an invite link. Like the staff invite (/auth/confirm), the
// cookie names the link this browser already used and the account it signed
// in, when saving the password failed after that, so a retry with the same
// link can finish the job for that account and no other.
export async function setAgentPassword(_previous: SetAgentPasswordState, formData: FormData): Promise<SetAgentPasswordState> {
  const tokenHash = String(formData.get("token_hash") ?? "")
  const password = String(formData.get("password") ?? "")
  if (!tokenHash) return { error: "invalid-link" }
  if (password !== String(formData.get("confirm") ?? "")) return { error: "password-mismatch" }

  const jar = await cookies()
  const [verifiedToken, verifiedUserId] = (jar.get(VERIFIED_COOKIE)?.value ?? "").split(" ")
  const retrying = verifiedToken === tokenHash && Boolean(verifiedUserId)

  const result = await acceptAgentInvite(await createClient(), tokenHash, password, retrying ? { verifiedUserId } : {})
  if (!result.ok) {
    if ("userId" in result) {
      jar.set(VERIFIED_COOKIE, `${tokenHash} ${result.userId}`, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: PATH,
        maxAge: 60 * 60,
      })
    }
    return { error: result.error }
  }

  if (retrying) jar.delete({ name: VERIFIED_COOKIE, path: PATH })
  // The students page greets a password set just now once, with a button on
  // to the list (#497 state 4, owner's pick A). The cookie names this agent's
  // code, so it greets no other account.
  jar.set(WELCOME_COOKIE, result.data.code, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: WELCOME_PATH,
    maxAge: WELCOME_MAX_AGE,
  })
  redirect(WELCOME_PATH)
}
