"use client"

import { createContext, startTransition, use, useCallback, useEffect, useState, type ComponentProps, type FormEvent, type ReactNode } from "react"

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
//
// Every switch records its pick here, and a page rendered per request (which
// reads the cookie itself) reports the cookie's language with
// `SyncPageLanguage`, so the value never lags behind the cookie.

type PageLanguage = {
  // The cookie's language as this page load last knew it, or null before anything set or reported it.
  current: Language | null
  // True once the visitor picked a language on this page load, so a `lang` cookie exists.
  picked: boolean
  choose: (language: Language) => void
  report: (language: Language) => void
}

const PageLanguageContext = createContext<PageLanguage>({ current: null, picked: false, choose: () => {}, report: () => {} })

export function PageLanguageProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<Language | null>(null)
  const [picked, setPicked] = useState(false)
  const choose = useCallback((language: Language) => {
    setCurrent(language)
    setPicked(true)
  }, [])
  return <PageLanguageContext value={{ current, picked, choose, report: setCurrent }}>{children}</PageLanguageContext>
}

/** The page's language: the cookie's, as last set or reported on this page load, else the copy's. */
export function usePageLanguage(copyLanguage: Language): Language {
  return use(PageLanguageContext).current ?? copyLanguage
}

/** True once the visitor has picked a language on this page load, so a `lang` cookie exists. */
export function useLanguageChosen(): boolean {
  return use(PageLanguageContext).picked
}

/** Records a pick, however it reached the cookie. */
export function useChooseLanguage(): (language: Language) => void {
  return use(PageLanguageContext).choose
}

/** On a page rendered per request: reports the language its cookie holds. */
export function SyncPageLanguage({ language }: { language: Language }) {
  const { report } = use(PageLanguageContext)
  useEffect(() => report(language), [language, report])
  return null
}

/**
 * Sets the `lang` cookie without rendering the page again (app/api/language).
 * The switch's Server Action would make Next.js render the page again, and
 * here that render is the copy for the cookie the request carried, so the
 * form would remount. False when the cookie couldn't be set.
 */
export async function storeLanguage(language: Language): Promise<boolean> {
  const data = new FormData()
  data.set("lang", language)
  try {
    return (await fetch("/api/language", { method: "POST", body: data })).ok
  } catch {
    return false
  }
}

/**
 * A language switch form's submit handler for a page that switches in place.
 * With JavaScript it sets the cookie (`storeLanguage`), then shows the new
 * language once the cookie is set, as the re-render did before. Without
 * JavaScript the form posts to `setLanguage` with its `return_to`, and the
 * visitor lands on the other copy.
 */
export function useSwitchInPlace(): (event: FormEvent<HTMLFormElement>) => void {
  const choose = useChooseLanguage()
  return (event) => {
    const lang = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")
    // No submitter to read: let the form's action run and return to the page.
    if (!isLanguage(lang)) return
    event.preventDefault()
    startTransition(async () => {
      // The cookie didn't change, and neither does the page.
      if (!(await storeLanguage(lang))) return
      choose(lang)
    })
  }
}

/** A public page's `<main>`, with `lang` following the page's language. */
export function PageMain({ language, ...props }: ComponentProps<"main"> & { language: Language }) {
  return <main {...props} lang={usePageLanguage(language)} />
}

/**
 * A language switch form's submit handler for a cached page that leaves for
 * the other copy (`/`): records the pick, and lets the form's action run.
 */
export function useRecordPick(): (event: FormEvent<HTMLFormElement>) => void {
  const choose = useChooseLanguage()
  return (event) => {
    const lang = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value")
    if (isLanguage(lang)) choose(lang)
  }
}
