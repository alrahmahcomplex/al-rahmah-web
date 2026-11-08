import type { Metadata } from "next"

import { LINK_REQUEST_COPY } from "@/app/discount-code/link-request-copy"
import { CallOffice, LinkRequestForm, SignInLink } from "@/app/discount-code/link-request-form"
import { AuthCard, AuthHeading } from "@/components/auth-card"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return {
    title: `${LINK_REQUEST_COPY[language].forgotHeading} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// "Umesahau nenosiri?" from /login (#194, moved here in #264), in the same
// card, for staff and Discount code holders alike (#265): a reset link for
// someone who has joined, a new invite for someone invited who hasn't, the
// same reply for everyone. The office is the fallback. No session is read,
// so the page works while Supabase is down.
export default async function ForgotPasswordPage() {
  const language = await getLanguage()
  const copy = LINK_REQUEST_COPY[language]

  return (
    <AuthCard language={language}>
      <AuthHeading intro={copy.forgotIntro}>{copy.forgotHeading}</AuthHeading>
      <div className="flex flex-col gap-5">
        <LinkRequestForm language={language} form="agent-reset" />
        <CallOffice language={language} officePhone={OFFICE_PHONE} />
        <SignInLink language={language} />
      </div>
    </AuthCard>
  )
}
