import type { Metadata } from "next"
import { cookies } from "next/headers"

import { SignOutNotice } from "@/app/discount-code/account-message"
import { LINK_REQUEST_COPY } from "@/app/discount-code/link-request-copy"
import { AuthCard } from "@/components/auth-card"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { RESET_PATH, RESET_VERIFIED_COOKIE, retryFor } from "@/lib/password-reset"
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
// expired or used link offers "Tuma kiungo kipya". The one session it keeps
// is the one this link signed in when saving the password failed: the link
// is spent by then, so the retry needs that session.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}) {
  const [language, { token_hash: tokenHash, type }] = await Promise.all([getLanguage(), searchParams])
  const usable = typeof tokenHash === "string" && tokenHash !== "" && type === "recovery"
  const supabase = usable ? await createClient() : null
  const session = supabase ? await currentSessionKind(supabase) : null
  const retryUserId = usable ? retryFor((await cookies()).get(RESET_VERIFIED_COOKIE)?.value, tokenHash) : null
  const retrying =
    retryUserId !== null && supabase !== null && (await supabase.auth.getUser()).data.user?.id === retryUserId

  return (
    <AuthCard language={language}>
      {usable && !retrying && session?.ok && session.data !== "none" ? (
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
