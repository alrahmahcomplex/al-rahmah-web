"use client"

import { useEffect } from "react"

import type { Language } from "@/lib/language"

// Sets `<html lang>` to the public page's language while the page shows. The
// root layout serves every page, staff ones included, and can't read the
// language without making the staff side Swahili too, so it says `en` and
// each bilingual page corrects it here. Leaving the page puts `en` back.
export function DocumentLanguage({ language }: { language: Language }) {
  useEffect(() => {
    const root = document.documentElement
    root.lang = language
    return () => {
      root.lang = "en"
    }
  }, [language])
  return null
}
