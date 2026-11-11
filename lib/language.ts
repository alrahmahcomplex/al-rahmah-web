import { cookies } from "next/headers"

import { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_COOKIE, type Language } from "./languages"

export { DEFAULT_LANGUAGE, isLanguage, LANGUAGE_COOKIE, type Language }

// The public site's language: Swahili unless the visitor switches to English.
// The choice is the `lang` cookie, so every public page is in it from the
// first byte. The staff side stays English.
//
// `/`, `/apply` and `/login/forgot-password` never read it: each is built
// once per language state and served from Vercel's cache, and a rewrite picks
// the copy from the cookie (lib/language-state.ts, ADR 0006). The pages that
// render per request (the sign-in, reset and Discount code pages) read it
// here.
export async function getLanguage(): Promise<Language> {
  const value = (await cookies()).get(LANGUAGE_COOKIE)?.value
  return isLanguage(value) ? value : DEFAULT_LANGUAGE
}

const ONE_YEAR = 60 * 60 * 24 * 365

// The `lang` cookie the switch sets: the whole site, one year, and HttpOnly.
export function languageCookieOptions() {
  return {
    path: "/",
    maxAge: ONE_YEAR,
    sameSite: "lax" as const,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  }
}
