import { setLanguage } from "@/app/actions/language"
import type { Language } from "@/lib/language"
import { cn } from "@/lib/utils"

const OPTIONS: readonly { lang: Language; label: string }[] = [
  { lang: "sw", label: "Kiswahili" },
  { lang: "en", label: "English" },
]

const GROUP_LABEL: Record<Language, string> = { sw: "Lugha", en: "Language" }

// The public site's language switch. Each option names its language in that
// language. It posts to a Server Action, so it works before the page's
// JavaScript loads, and with JavaScript the page re-renders in place.
export function LanguageSwitch({ language, className }: { language: Language; className?: string }) {
  return (
    <form action={setLanguage} className={className}>
      <div
        role="group"
        aria-label={GROUP_LABEL[language]}
        className="inline-flex h-11 items-center rounded-full border border-blue-600/30 bg-white p-1 shadow-sm"
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
                "h-full rounded-full px-4 font-exo text-sm font-bold italic transition-colors outline-none focus-visible:ring-3 focus-visible:ring-blue-600/40",
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
