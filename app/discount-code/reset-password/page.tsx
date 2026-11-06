import type { Metadata } from "next"

import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { currentSessionKind } from "@/lib/services/auth-session"
import { createClient } from "@/utils/supabase/server"

import { ACCOUNT_COPY } from "../account-copy"
import { SignOutNotice } from "../account-message"
import { AccountShell } from "../account-shell"
import { LINK_REQUEST_COPY } from "../link-request-copy"
import { SetPasswordForm } from "../set-password/set-password-form"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return {
    title: `${LINK_REQUEST_COPY[language].resetHeading} · ${ACCOUNT_COPY[language].title} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// Where the agent's reset email lands (#194): the recovery template's
// token_hash link. As on the invite's page, loading leaves the token alone,
// so an email link scanner can't use it up, and a browser signed in as staff
// signs out first. An expired or used link offers "Tuma kiungo kipya".
export default async function AgentResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token_hash?: string; type?: string }>
}) {
  const [language, { token_hash: tokenHash, type }] = await Promise.all([getLanguage(), searchParams])
  const usable = typeof tokenHash === "string" && tokenHash !== "" && type === "recovery"
  const session = usable ? await currentSessionKind(await createClient()) : null

  return (
    <AccountShell language={language}>
      {usable && session?.ok && session.data === "staff" ? (
        <SignOutNotice
          language={language}
          message={ACCOUNT_COPY[language].messages["staff-session"]}
          back={`/discount-code/reset-password?token_hash=${encodeURIComponent(tokenHash)}&type=recovery`}
        />
      ) : (
        <SetPasswordForm
          language={language}
          tokenHash={usable ? tokenHash : null}
          linkType="recovery"
          officePhone={OFFICE_PHONE}
        />
      )}
    </AccountShell>
  )
}
