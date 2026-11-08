import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { AuthCard } from "@/components/auth-card"
import { getLanguage } from "@/lib/language"
import { signedInHome } from "@/lib/services/sign-in"
import { createClient } from "@/utils/supabase/server"

import { LOGIN_COPY, LOGIN_NOTICES } from "./copy"
import { LoginForm } from "./login-form"

export async function generateMetadata(): Promise<Metadata> {
  return {
    title: `${LOGIN_COPY[await getLanguage()].title} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// The one sign-in page (#264) for staff and Discount code holders. A browser
// already signed in goes to its own side, so one browser never holds two
// accounts' sessions.
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [language, { error }] = await Promise.all([getLanguage(), searchParams])
  const home = await signedInHome(await createClient())
  if (home) redirect(home)

  const notice = LOGIN_NOTICES.find((n) => n === error) ?? null
  return (
    <AuthCard language={language}>
      <LoginForm language={language} notice={notice} />
    </AuthCard>
  )
}
