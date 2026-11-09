import type { Metadata } from "next"

import { languagePromptNeeded } from "@/components/brand/language-cookie"
import { publicInterviewDiscount } from "@/lib/interview-discount"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"

import { DiscountCodeFrame } from "./frame"
import { COPY } from "./copy"
import { DiscountCodeForm } from "./registration-form"

// Where someone the school wants bringing in families gets a Discount code.
// The school hands out the URL itself: nothing links here and search engines
// are asked to leave it out. It stays out of the proxy matcher and reads only
// the interview discount, with the secret key and a short wait, so it still
// loads with Supabase down and then names no figure. Sending touches the
// database. The top bar's language control re-renders the page around the
// form, which keeps its entries in client state.

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return {
    title: `${COPY[language].title} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

export default async function DiscountCodePage() {
  const [language, discount, showLanguagePrompt] = await Promise.all([getLanguage(), publicInterviewDiscount(), languagePromptNeeded()])

  return (
    <DiscountCodeFrame language={language}>
      <DiscountCodeForm language={language} officePhone={OFFICE_PHONE} discount={discount} showLanguagePrompt={showLanguagePrompt} />
    </DiscountCodeFrame>
  )
}
