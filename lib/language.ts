import { cookies } from "next/headers"

// The public site's language: Swahili unless the visitor switches to English.
// The choice is a cookie read on the server, so every public page renders in
// it from the first byte. The staff side stays English.
export const LANGUAGE_COOKIE = "lang"

export type Language = "sw" | "en"

export const DEFAULT_LANGUAGE: Language = "sw"

export function isLanguage(value: unknown): value is Language {
  return value === "sw" || value === "en"
}

export async function getLanguage(): Promise<Language> {
  const value = (await cookies()).get(LANGUAGE_COOKIE)?.value
  return isLanguage(value) ? value : DEFAULT_LANGUAGE
}
