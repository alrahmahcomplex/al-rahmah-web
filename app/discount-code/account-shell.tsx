import type { ReactNode } from "react"

import { BrandTopBar } from "@/components/brand"
import { languagePromptNeeded } from "@/components/brand/language-cookie"
import type { Language } from "@/lib/language"

import { ACCOUNT_COPY } from "./account-copy"
import { CARD, DiscountCodeFrame } from "./frame"

// The Discount code account pages (students, set password, messages): the
// frame (./frame.tsx), the COMPLEX top bar without "Futa fomu yote", the
// sr-only page title, then the card. `wide` is for the students list.
export async function AccountShell({
  language,
  children,
  wide = false,
  title,
}: {
  language: Language
  children: ReactNode
  wide?: boolean
  title?: string
}) {
  const showLanguagePrompt = await languagePromptNeeded()
  return (
    <DiscountCodeFrame language={language} wide={wide}>
      <BrandTopBar variant="complex" language={language} showLanguagePrompt={showLanguagePrompt} />
      <h1 className="sr-only">{title ?? ACCOUNT_COPY[language].title}</h1>
      <div className={CARD}>{children}</div>
    </DiscountCodeFrame>
  )
}
