"use client"

import { setLanguage } from "@/app/actions/language"
import { DocumentLanguage } from "@/components/document-language"
import type { Language } from "@/lib/language"
import type { CachedPublicPath } from "@/lib/language-state"
import { usePageLanguage, useSwitchInPlace } from "@/components/page-language"
import { cn } from "@/lib/utils"

const OPTIONS: readonly { lang: Language; label: string }[] = [
  { lang: "sw", label: "Kiswahili" },
  { lang: "en", label: "English" },
]

const GROUP_LABEL: Record<Language, string> = { sw: "Lugha", en: "Language" }

// The public site's language switch. Each option names its language in that
// language. It posts to a Server Action, so it works before the page's
// JavaScript loads, and with JavaScript the page re-renders in place.
//
// A page served from Vercel's cache passes its public address as `returnTo`:
// the action then sends the visitor back there, and the new cookie picks the
// other language's copy (lib/language-state.ts). With `inPlace`, and
// JavaScript, the page switches without leaving it, so a form on it keeps
// what the visitor typed (components/page-language.tsx).
//
// Every bilingual page shows it, so it also keeps `<html lang>` matching the
// page. Each option is 44px tall on a phone. When the phone's text is made
// so large the two options can't sit side by side, they stack rather than
// push the page sideways.
export function LanguageSwitch({
  language: copyLanguage,
  returnTo,
  inPlace = false,
  className,
}: {
  language: Language
  returnTo?: CachedPublicPath
  inPlace?: boolean
  className?: string
}) {
  const shown = usePageLanguage(copyLanguage)
  const language = inPlace ? shown : copyLanguage
  const switchInPlace = useSwitchInPlace()
  return (
    <form action={setLanguage} onSubmit={inPlace ? switchInPlace : undefined} className={className}>
      <DocumentLanguage language={language} />
      {returnTo ? <input type="hidden" name="return_to" value={returnTo} /> : null}
      <div
        role="group"
        aria-label={GROUP_LABEL[language]}
        className="inline-flex max-w-full flex-wrap items-stretch justify-center rounded-[1.5rem] border border-blue-600/30 bg-white p-0.5 shadow-sm sm:rounded-full sm:p-1"
      >
        {OPTIONS.map(({ lang, label }) => {
          const current = lang === language
          return (
            <button
              key={lang}
              type="submit"
              name="lang"
              value={lang}
              lang={lang}
              aria-pressed={current}
              className={cn(
                "min-h-11 grow rounded-full px-3 font-exo text-sm font-bold italic transition-colors outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40 sm:min-h-[34px] sm:px-4",
                current ? "bg-blue-600 text-white" : "text-blue-600 hover:bg-blue-50",
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
    </form>
  )
}
