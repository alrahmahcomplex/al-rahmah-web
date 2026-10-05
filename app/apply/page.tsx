import type { Metadata } from "next"
import { cookies } from "next/headers"
import Image from "next/image"
import Link from "next/link"

import { LanguageSwitch } from "@/components/language-switch"
import { admissionYears } from "@/lib/admission-form"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { DISCOUNT_CODE_COOKIE, initialDiscountCode } from "@/lib/referral-link"

import { AdmissionFormSteps } from "./admission-form"
import { COPY } from "./copy"

// The public Admission form. Like the home page it reads no Supabase and stays
// out of the proxy matcher, so it loads with Supabase down; only sending
// touches the database. The language switch sits outside the form: switching
// re-renders this page in place, and the form keeps its entries in client
// state.
//
// A Referral link (`/apply?ref=<code>`) fills in the Discount code, and the
// form remembers it for 30 days in a cookie, so a parent who comes back
// without the link still finds it. The code isn't checked here, since that
// would need Supabase; the review step checks it.

export async function generateMetadata(): Promise<Metadata> {
  const language = await getLanguage()
  return { title: `${COPY[language].title} · Al-Rahmah Complex` }
}

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ ref?: string | string[] }>
}) {
  const language = await getLanguage()
  const discountCode = initialDiscountCode({
    ref: (await searchParams).ref,
    cookie: (await cookies()).get(DISCOUNT_CODE_COOKIE)?.value,
  })

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

        <AdmissionFormSteps
          language={language}
          years={admissionYears()}
          officePhone={OFFICE_PHONE}
          discountCode={discountCode.code}
          rememberDiscountCode={discountCode.remember}
        />
      </div>
    </main>
  )
}
