"use client"

import { useEffect } from "react"

import { LINK_REQUEST_COPY } from "@/app/discount-code/link-request-copy"
import { CallOffice, SignInLink } from "@/app/discount-code/link-request-form"
import { AuthCard } from "@/components/auth-card"
import { usePageLanguage } from "@/components/page-language"
import type { Language } from "@/lib/language"

import { ForgotPasswordFlow } from "./forgot-password-flow"

// "Umesahau nenosiri?" in the sign-in card. Its words render in the browser
// from the page's language, so the switch changes them in place and the email
// typed so far stays (components/page-language.tsx). The steps by SMS
// (#503) are in forgot-password-flow.tsx.
export function ForgotPasswordCard({ language: copyLanguage, officePhone }: { language: Language; officePhone: string }) {
  const language = usePageLanguage(copyLanguage)
  const copy = LINK_REQUEST_COPY[language]

  // Keeps the tab's title in the page's language after a switch.
  useEffect(() => {
    document.title = `${copy.forgotHeading} · Al-Rahmah Complex`
  }, [copy.forgotHeading])

  return (
    <AuthCard language={language} returnTo="/auth/forgot-password">
      <div className="flex flex-col gap-5">
        <div className="flex flex-col">
          <ForgotPasswordFlow language={language} />
        </div>
        <CallOffice language={language} officePhone={officePhone} />
        <SignInLink language={language} />
      </div>
    </AuthCard>
  )
}
