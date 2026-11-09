import type { Metadata } from "next"
import { cookies } from "next/headers"

import { languagePromptNeeded } from "@/components/brand/language-cookie"
import { admissionYears } from "@/lib/admission-form"
import { getLanguage } from "@/lib/language"
import { OFFICE_PHONE } from "@/lib/office"
import { DISCOUNT_CODE_COOKIE, initialDiscountCode } from "@/lib/referral-link"
import { tanzaniaToday } from "@/lib/school-calendar"

import { AdmissionFormSteps } from "./admission-form"
import { COPY } from "./copy"
import { defaultYear } from "./flow"

// The public Admission form. Like the home page it reads no Supabase and stays
// out of the proxy matcher, so it loads with Supabase down; only sending
// touches the database, and the live figures arrive from /api/apply/live
// once the page is up. The brand top bar and its menu (which holds the
// language switch) render inside the form, since "Clear the whole form" needs
// the form's state: switching language re-renders this page in place, and
// the form keeps its entries in client state.
//
// A Referral link (`/apply?ref=<code>`) fills in the Discount code, and the
// form remembers it for 30 days in a cookie, so a parent who comes back
// without the link still finds it. The code isn't checked here, since that
// would need Supabase; the Discount code question checks it.

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
  const years = admissionYears()

  return (
    <main lang={language} className="min-h-dvh bg-gradient-to-br from-blue-50 via-blue-100/50 to-white px-4 py-4 sm:px-8 sm:py-6">
      <div className="mx-auto flex w-full max-w-[480px] min-w-0 flex-col gap-4">
        <AdmissionFormSteps
          language={language}
          years={years}
          defaultYear={defaultYear(years, tanzaniaToday())}
          officePhone={OFFICE_PHONE}
          discountCode={discountCode.code}
          rememberDiscountCode={discountCode.remember}
          showLanguagePrompt={await languagePromptNeeded()}
        />
      </div>
    </main>
  )
}
