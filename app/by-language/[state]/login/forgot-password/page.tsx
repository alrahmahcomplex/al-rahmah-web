import type { Metadata } from "next"

import { LINK_REQUEST_COPY } from "@/app/discount-code/link-request-copy"
import { ForgotPasswordCard } from "@/app/login/forgot-password-card"
import { isLanguageState, LANGUAGE_STATES, languageOfState, type LanguageState } from "@/lib/language-state"
import { OFFICE_PHONE } from "@/lib/office"

// "Umesahau nenosiri?" from /login (#194, moved here in #264), at
// `/login/forgot-password`, in the same card, for staff and Discount code
// holders alike (#265): a reset link for someone who has joined, a new invite
// for someone invited who hasn't, the same reply for everyone. The office is
// the fallback. No session is read, so the page works while Supabase is down.
//
// It reads nothing from the request: it is built once per language state and
// served from Vercel's cache, and a rewrite picks the copy from the `lang`
// cookie (lib/language-state.ts, ADR 0006).

type Props = { params: Promise<{ state: string }> }

export const dynamicParams = false

export function generateStaticParams(): { state: LanguageState }[] {
  return LANGUAGE_STATES.map((state) => ({ state }))
}

async function languageOf(params: Props["params"]) {
  const { state } = await params
  return languageOfState(isLanguageState(state) ? state : "sw")
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const language = await languageOf(params)
  return {
    title: `${LINK_REQUEST_COPY[language].forgotHeading} · Al-Rahmah Complex`,
    robots: { index: false, follow: false },
  }
}

export default async function ForgotPasswordPage({ params }: Props) {
  return <ForgotPasswordCard language={await languageOf(params)} officePhone={OFFICE_PHONE} />
}
