import { Phone } from "lucide-react"
import type { Metadata } from "next"
import Link from "next/link"

import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"

import { ACCOUNT_COPY } from "../account-copy"
import { AccountShell } from "../account-shell"

export async function generateMetadata(): Promise<Metadata> {
  const copy = ACCOUNT_COPY[await getLanguage()]
  return { title: `${copy.forgotHeading} · ${copy.title} · Al-Rahmah Complex`, robots: { index: false, follow: false } }
}

// "Umesahau nenosiri?" from the sign-in page. Until the self-service reset
// (#194) replaces it, the office sends a new link.
export default async function AgentForgotPasswordPage() {
  const language = await getLanguage()
  const copy = ACCOUNT_COPY[language]

  return (
    <AccountShell language={language}>
      <div className="flex flex-col items-center gap-4 text-center">
        <h1 className="font-exo text-2xl font-extrabold italic text-blue-600">{copy.forgotHeading}</h1>
        <p className="font-exo text-[14px] text-slate-700">{copy.forgotText}</p>
        <a
          href={`tel:${OFFICE_PHONE.replace(/\s/g, "")}`}
          className="inline-flex h-11 items-center gap-2 rounded-full bg-blue-600 px-6 font-exo text-base font-bold italic text-white shadow-md hover:bg-blue-700"
        >
          <Phone className="h-4 w-4" strokeWidth={1.5} />
          {copy.callOffice}: {OFFICE_PHONE}
        </a>
        <Link href="/discount-code/sign-in" className="font-exo text-[13px] text-blue-600 underline underline-offset-2">
          {copy.goToSignIn}
        </Link>
      </div>
    </AccountShell>
  )
}
