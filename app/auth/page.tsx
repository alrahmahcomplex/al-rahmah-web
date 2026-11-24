import type { Metadata } from "next"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth-card"
import { getLanguage } from "@/lib/language"
import { maskLogin } from "@/lib/mask-login"
import { currentAuthUser } from "@/lib/services/auth-session"
import { signedInHome } from "@/lib/services/sign-in"
import { requestHostAudience } from "@/lib/site-hosts"
import { createClient } from "@/utils/supabase/server"

import { LOGIN_COPY, LOGIN_NOTICES } from "./copy"
import { LoginForm } from "./login-form"
import { MovedToAgentsNotice } from "./moved-notice"

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${LOGIN_COPY[await getLanguage()].title} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// The sign-in page (#264, #539): on portal. for staff, on agents. for Discount
// code holders, and on localhost/Previews for both. A browser already signed
// in goes to its own side. A Discount code holder already signed in on portal.
// sees "Your pages have moved" (A-N6..A-N9) with a constant link to agents.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; from?: string }> }) {
  const [language, { error, from }, requestHeaders, supabase] = await Promise.all([
    getLanguage(),
    searchParams,
    headers(),
    createClient(),
  ])
  const audience = requestHostAudience(requestHeaders)
  const home = await signedInHome(supabase, audience)
  if (home.kind === "home") redirect(home.path)

  if (home.kind === "wrong-host" && home.as === "agent") {
    const userResult = await currentAuthUser(supabase)
    const user = userResult.ok ? userResult.data : null
    const masked = maskLogin({ email: user?.email, phone: user?.phone })
    return (
      <AuthCard language={language}>
        <MovedToAgentsNotice language={language} maskedLogin={masked} />
      </AuthCard>
    )
  }

  const notice = LOGIN_NOTICES.find((n) => n === error) ?? null
  const noteKind = from === "moved" ? "moved" : from === "home" || from === "students" ? "students" : null
  return (
    <AuthCard language={language}>
      <LoginForm language={language} notice={notice} noteKind={noteKind} showSignUp={audience === "agents"} />
    </AuthCard>
  )
}
