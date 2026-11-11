import type { Metadata } from "next"

import { AdmissionFormSteps } from "@/app/apply/admission-form"
import { COPY } from "@/app/apply/copy"
import { defaultYear } from "@/app/apply/flow"
import { PageMain } from "@/components/page-language"
import { admissionYears } from "@/lib/admission-form"
import { isLanguageState, LANGUAGE_STATES, languageOfState, promptNeededInState, type LanguageState } from "@/lib/language-state"
import { OFFICE_PHONE } from "@/lib/office"
import { tanzaniaToday } from "@/lib/school-calendar"

// The public Admission form, at `/apply`. Like the home page it reads no
// Supabase and stays out of the proxy matcher, so it loads with Supabase down;
// only sending touches the database, and the live figures arrive from
// /api/apply/live once the page is up. The brand top bar and its menu (which
// holds the language switch) render inside the form, since "Clear the whole
// form" needs the form's state.
//
// It reads nothing from the request: it is built once per language state and
// served from Vercel's cache, and a rewrite picks the copy from the `lang`
// cookie (lib/language-state.ts, ADR 0006). So nothing in it belongs to one
// visitor:
//
// - A Referral link (`/apply?ref=<code>`) and the Discount code the browser
//   remembers for 30 days are read by the form in the browser, after it loads.
// - The admission years here are the build's. The form works them out again
//   in the browser as it opens, and takes the server's from a refusal, so a
//   copy built before 1 January or 1 April still offers the right years.
// - Switching language changes the form in place (components/page-language.tsx).

type Props = { params: Promise<{ state: string }> }

export const dynamicParams = false

export function generateStaticParams(): { state: LanguageState }[] {
  return LANGUAGE_STATES.map((state) => ({ state }))
}

async function stateOf(params: Props["params"]): Promise<LanguageState> {
  const { state } = await params
  return isLanguageState(state) ? state : "sw"
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const language = languageOfState(await stateOf(params))
  return { title: `${COPY[language].title} · Al-Rahmah Complex` }
}

export default async function ApplyPage({ params }: Props) {
  const state = await stateOf(params)
  const language = languageOfState(state)
  const years = admissionYears()

  return (
    <PageMain language={language} className="min-h-dvh bg-gradient-to-br from-blue-50 via-blue-100/50 to-white px-4 py-4 sm:px-8 sm:py-6">
      <div className="mx-auto flex w-full max-w-[480px] min-w-0 flex-col gap-4">
        <AdmissionFormSteps
          language={language}
          years={years}
          defaultYear={defaultYear(years, tanzaniaToday())}
          officePhone={OFFICE_PHONE}
          showLanguagePrompt={promptNeededInState(state)}
        />
      </div>
    </PageMain>
  )
}
