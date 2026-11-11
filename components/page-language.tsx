"use client"

import { createContext, startTransition, use, useState, type ComponentProps, type FormEvent, type ReactNode } from "react"

import { setLanguage } from "@/app/actions/language"
import { isLanguage, type Language } from "@/lib/languages"

// The language a visitor switched to on this page load, for the public pages
// Vercel serves from its cache (lib/language-state.ts, ADR 0006).
//
// Such a page is the copy built for one language, so re-rendering it after the
// switch would come back in the old language, and moving to the other copy
// would remount it and drop what a parent typed. Instead the page renders its
// words in the browser from this value. It lives in the root layout, so it
// outlasts navigation and a copy restored from the router's cache shows the
// language the cookie now holds. A full page load starts it empty again, and
// the cookie picks the copy.

type PageLanguage = { chosen: Language | null; choose: (language: Language) => void }

const PageLanguageContext = createContext<PageLanguage>({ chosen: null, choose: () => {} })

export function PageLanguageProvider({ children }: { children: ReactNode }) {
  const [chosen, choose] = useState<Language | null>(null)
  return <PageLanguageContext value={{ chosen, choose }}>{children}</PageLanguageContext>
}

/** The page's language: the one switched to on this page load, else the copy's. */
export function usePageLanguage(copyLanguage: Language): Language {
  return use(PageLanguageContext).chosen ?? copyLanguage
}

/** True once the visitor has picked a language on this page load, so a `lang` cookie exists. */
export function useLanguageChosen(): boolean {
  return use(PageLanguageContext).chosen !== null
}

/** Records a pick made through `setLanguage` elsewhere (the first-visit card). */
export function useChooseLanguage(): (language: Language) => void {
  return use(PageLanguageContext).choose
}

/**
 * A language switch form's submit handler for a page that switches in place.
 * With JavaScript it sets the cookie through `setLanguage` with no address to
 * return to, then shows the new language once the cookie is set, as the
 * re-render did before. Without JavaScript the form posts with its
 * `return_to`, and the visitor lands on the other copy.
 */
export function useSwitchInPlace(): (event: FormEvent<HTMLFormElement>) => void {
  const choose = useChooseLanguage()
  return (event) => {
    const lang = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")
    // No submitter to read: let the form's action run and return to the page.
    if (!isLanguage(lang)) return
    event.preventDefault()
    const data = new FormData()
    data.set("lang", lang)
    startTransition(async () => {
      try {
        await setLanguage(data)
      } catch {
        // The cookie didn't change, and neither does the page.
        return
      }
      choose(lang)
    })
  }
}

/** A public page's `<main>`, with `lang` following the page's language. */
export function PageMain({ language, ...props }: ComponentProps<"main"> & { language: Language }) {
  return <main {...props} lang={usePageLanguage(language)} />
}
