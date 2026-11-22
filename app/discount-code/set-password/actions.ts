"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { after } from "next/server"

import { acceptAgentInvite, type AcceptAgentInviteError } from "@/lib/services/agent-auth"
import { localOfficePhone } from "@/lib/office"
import { courtesySms, joinedBySelfConfirm, sendCourtesySms } from "@/lib/services/agent-self-confirm"
import { smsSender } from "@/lib/services/sms"
import { smsClient } from "@/utils/supabase/sms"
import { verifiedUserId as sessionUserId } from "@/lib/services/auth-session"
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

  const supabase = await createClient()
  const result = await acceptAgentInvite(supabase, tokenHash, password, retrying ? { verifiedUserId } : {})
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
  // to the list (#497 state 4, owner's pick A). The cookie names this login,
  // not the code a recreated record would share, so it greets no other
  // account. With no verified session there is nothing to greet.
  const userId = await sessionUserId(supabase)
  if (userId) {
    const selfConfirmed = await joinedBySelfConfirm(supabase)
    // The courtesy SMS (decision 78) to the mobile on file, after the answer.
    if (selfConfirmed) {
      const secret = smsClient()
      if (secret) {
        after(async () => {
          const sent = await sendCourtesySms(secret, smsSender(), userId, (openedWith) => courtesySms(openedWith, localOfficePhone()))
          if (!sent.ok) console.error(`Courtesy SMS: not sent (${sent.error})`)
        })
      }
    }
    // ".self": an email self-confirm, whose welcome says the account is ready (O-N17).
    jar.set(WELCOME_COOKIE, selfConfirmed ? `${userId}.self` : userId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: WELCOME_PATH,
      maxAge: WELCOME_MAX_AGE,
    })
  }
  redirect(WELCOME_PATH)
}
