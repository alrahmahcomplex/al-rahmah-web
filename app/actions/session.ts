"use server"

import { redirect } from "next/navigation"

import { safeNextPath } from "@/lib/safe-next-path"
import { signOutSession } from "@/lib/services/auth-session"
import { createClient } from "@/utils/supabase/server"

// The pages that refuse while another kind of account is signed in in this
// browser (one account per browser), and to which signing out returns, with
// their query (the invite or reset link). Matched by the whole path, so no
// other address under /auth or /discount-code comes back.
const RETURN_TO = ["/auth", "/auth/confirm", "/auth/reset-password", "/discount-code/set-password"]

function returnPath(back: string): string {
  return RETURN_TO.includes(back.split(/[?#]/)[0]) ? back : "/auth"
}

// "Sign out" on a page refusing the other kind of session: ends it, then
// shows the same page again, invite link included, so the link still works.
export async function signOutAndReturn(formData: FormData): Promise<void> {
  const back = safeNextPath(String(formData.get("back") ?? ""))
  const supabase = await createClient()
  await signOutSession(supabase)
  redirect(returnPath(back))
}
