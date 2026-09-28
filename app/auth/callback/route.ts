import { NextResponse } from "next/server"

import { safeNextPath } from "@/lib/safe-next-path"
import { exchangeEmailLinkCode, getStaffUser, signOutStaff } from "@/lib/services/staff-auth"
import { createClient } from "@/utils/supabase/server"

// Landing point for Supabase email links (password reset, invitations).
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get("code")
  const next = safeNextPath(searchParams.get("next"))

  if (!code) return NextResponse.redirect(`${origin}/login?error=invalid-link`)

  const supabase = await createClient()
  const exchanged = await exchangeEmailLinkCode(supabase, code)
  if (!exchanged.ok) return NextResponse.redirect(`${origin}/login?error=invalid-link`)

  const staff = await getStaffUser(supabase)
  if (!staff.ok) {
    await signOutStaff(supabase)
    const reason = staff.error === "signed-out" ? "invalid-link" : staff.error
    return NextResponse.redirect(`${origin}/login?error=${reason}`)
  }

  return NextResponse.redirect(`${origin}${next}`)
}
