"use server"

import { cookies } from "next/headers"
import { redirect, RedirectType } from "next/navigation"

import { isLanguage, LANGUAGE_COOKIE, languageCookieOptions } from "@/lib/language"
import { isCachedPublicPath } from "@/lib/language-state"

// The language switch's action. Setting the cookie re-renders the current page
// in place, so a form on the page keeps what the visitor typed.
//
// A page served from Vercel's cache is the copy for the old cookie, so
// re-rendering it would come back in the old language. Such a page sends its
// public address as `return_to`, and the visitor is sent back there: the new
// cookie picks the other copy. Only the cached public addresses are accepted,
// so the field can't send anyone off the site. Replace, not push, so Back
// still leaves the page.
export async function setLanguage(formData: FormData): Promise<void> {
  const lang = formData.get("lang")
  if (!isLanguage(lang)) return

  const jar = await cookies()
  jar.set(LANGUAGE_COOKIE, lang, languageCookieOptions())

  const returnTo = formData.get("return_to")
  if (isCachedPublicPath(returnTo)) redirect(returnTo, RedirectType.replace)
}
