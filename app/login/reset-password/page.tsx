import type { Metadata } from "next"

import { SignOutNotice } from "@/app/discount-code/account-message"
import { LINK_REQUEST_COPY } from "@/app/discount-code/link-request-copy"
import { AuthCard } from "@/components/auth-card"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { RESET_PATH } from "@/lib/password-reset"
import { currentSessionKind } from "@/lib/services/auth-session"
import { createClient } from "@/utils/supabase/server"

import { ResetPasswordForm } from "./reset-password-form"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return {
    title: `${LINK_REQUEST_COPY[language].resetHeading} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// Where every reset email lands (#265), staff's and agents': the recovery
// template's token_hash link. Loading leaves the token alone, so an email
// link scanner can't use it up. A browser already signed in, as anyone,
// signs out first, so one browser never holds two accounts' sessions. An
// expired or used link offers "Tuma kiungo kipya".
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}) {
  const [language, { token_hash: tokenHash, type }] = await Promise.all([getLanguage(), searchParams])
  const usable = typeof tokenHash === "string" && tokenHash !== "" && type === "recovery"
  const session = usable ? await currentSessionKind(await createClient()) : null

  return (
    <AuthCard language={language}>
      {usable && session?.ok && session.data !== "none" ? (
        <SignOutNotice
          language={language}
          message={LINK_REQUEST_COPY[language].signedIn}
          back={`${RESET_PATH}?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`}
        />
      ) : (
        <ResetPasswordForm language={language} tokenHash={usable ? tokenHash : null} officePhone={OFFICE_PHONE} />
      )}
    </AuthCard>
  )
}
