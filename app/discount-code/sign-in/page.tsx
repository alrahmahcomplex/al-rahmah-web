import type { Metadata } from "next"
import { redirect } from "next/navigation"

import { getLanguage } from "@/lib/language"
import { getAgentUser } from "@/lib/services/agent-auth"
import { currentSessionKind } from "@/lib/services/auth-session"
import { createClient } from "@/utils/supabase/server"

import { ACCOUNT_COPY, SIGN_IN_NOTICES } from "../account-copy"
import { SignOutNotice } from "../account-message"
import { AccountShell } from "../account-shell"
import { AgentSignInForm } from "./sign-in-form"

export async function generateMetadata(): Promise<Metadata> {
  const copy = ACCOUNT_COPY[await getLanguage()]
  return {
    title: `${copy.signInHeading} · ${copy.title} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// Where a Discount code holder with an account signs in. One account per
// browser: while staff are signed in here, it asks them to sign out first.
export default async function AgentSignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [language, { error }] = await Promise.all([getLanguage(), searchParams])
  const supabase = await createClient()
  const session = await currentSessionKind(supabase)

  if (session.ok && session.data === "agent" && (await getAgentUser(supabase)).ok) redirect("/discount-code/students")

  const notice = SIGN_IN_NOTICES.find((n) => n === error) ?? null
  return (
    <AccountShell language={language}>
      {session.ok && session.data === "staff" ? (
        <SignOutNotice
          language={language}
          message={ACCOUNT_COPY[language].messages["staff-session"]}
          back="/discount-code/sign-in"
        />
      ) : (
        <AgentSignInForm language={language} notice={notice} />
      )}
    </AccountShell>
  )
}
