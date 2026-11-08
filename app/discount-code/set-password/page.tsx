import type { Metadata } from "next"

import { AuthCard } from "@/components/auth-card"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { currentSessionKind } from "@/lib/services/auth-session"
import { createClient } from "@/utils/supabase/server"

import { ACCOUNT_COPY } from "../account-copy"
import { SignOutNotice } from "../account-message"
import { SetPasswordForm } from "./set-password-form"

export async function generateMetadata(): Promise<Metadata> {
  const copy = ACCOUNT_COPY[await getLanguage()]
  return {
    title: `${copy.setPasswordHeading} · ${copy.title} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// Where the Discount code invite email lands. Loading the page leaves the
// token alone, so an email link scanner opening the link can't use it up.
// One account per browser: with staff signed in, it asks them to sign out
// first, before the token is used, and then shows the same link again.
export default async function AgentSetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}) {
  const [language, { token_hash: tokenHash, type }] = await Promise.all([getLanguage(), searchParams])
  const usable = typeof tokenHash === "string" && tokenHash !== "" && type === "invite"
  const session = usable ? await currentSessionKind(await createClient()) : null

  return (
    <AuthCard language={language}>
      {usable && session?.ok && session.data === "staff" ? (
        <SignOutNotice
          language={language}
          message={ACCOUNT_COPY[language].messages["staff-session"]}
          back={`/discount-code/set-password?token_hash=${encodeURIComponent(tokenHash)}&type=invite`}
        />
      ) : (
        <SetPasswordForm language={language} tokenHash={usable ? tokenHash : null} officePhone={OFFICE_PHONE} />
      )}
    </AuthCard>
  )
}
