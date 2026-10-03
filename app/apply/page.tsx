import type { Metadata } from "next"
import Image from "next/image"
import Link from "next/link"

import { LanguageSwitch } from "@/components/language-switch"
import { admissionYears } from "@/lib/admission-form"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"

import { AdmissionFormSteps } from "./admission-form"
import { COPY } from "./copy"

// The public Admission form. Like the home page it reads no Supabase and stays
// out of the proxy matcher, so it loads with Supabase down; only sending
// touches the database. The language switch sits outside the form: switching
// re-renders this page in place, and the form keeps its entries in client
// state.

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return { title: `${COPY[language].title} · Al-Rahmah Complex` }
}

export default async function ApplyPage() {
  const language = await getLanguage()

  return (
    <main
      lang={language}
      className="min-h-dvh bg-gradient-to-br from-blue-100 via-blue-100/50 to-white px-4 py-4 sm:px-8 sm:py-6"
    >
      <div className="mx-auto flex w-full max-w-[480px] flex-col gap-4">
        <header className="flex items-center gap-3">
          <Link href="/" className="shrink-0 rounded-full outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40">
            <Image src="/Al-Rahmah_Official_Logo.svg" alt="Al-Rahmah Logo" width={44} height={44} className="size-11" priority />
          </Link>
          <p className="min-w-0 font-exo text-lg font-extrabold italic leading-tight text-blue-600">{COPY[language].title}</p>
          <LanguageSwitch language={language} className="ml-auto shrink-0" />
        </header>

        <AdmissionFormSteps language={language} years={admissionYears()} officePhone={OFFICE_PHONE} />
      </div>
    </main>
  )
}
