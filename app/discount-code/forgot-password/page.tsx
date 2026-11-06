import type { Metadata } from "next"

import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"

import { ACCOUNT_COPY } from "../account-copy"
import { AccountShell } from "../account-shell"
import { LINK_REQUEST_COPY } from "../link-request-copy"
import { CallOffice, LinkRequestForm, SignInLink } from "../link-request-form"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return {
    title: `${LINK_REQUEST_COPY[language].forgotHeading} · ${ACCOUNT_COPY[language].title} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

// "Umesahau nenosiri?" from the sign-in page (#194): a reset link for an
// agent who has joined, a new invite for one who hasn't, the same reply for
// everyone. The office is the fallback.
export default async function AgentForgotPasswordPage() {
  const language = await getLanguage()
  const copy = LINK_REQUEST_COPY[language]

  return (
    <AccountShell language={language}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2 text-center">
          <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">{copy.forgotHeading}</h1>
          <p className="font-exo text-[13px] text-slate-600">{copy.forgotIntro}</p>
        </div>
        <LinkRequestForm language={language} form="agent-reset" />
        <CallOffice language={language} officePhone={OFFICE_PHONE} />
        <SignInLink language={language} />
      </div>
    </AccountShell>
  )
}
