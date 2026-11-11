// The public site's two languages and the cookie that holds the choice. Pure,
// so the browser, next.config.ts and the server share it; reading the cookie
// on the server is lib/language.ts.
export const LANGUAGE_COOKIE = "lang"

export type Language = "sw" | "en"

export const DEFAULT_LANGUAGE: Language = "sw"

export function isLanguage(value: unknown): value is Language {
  return value === "sw" || value === "en"
}
