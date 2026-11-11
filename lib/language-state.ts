import { DEFAULT_LANGUAGE, LANGUAGE_COOKIE, type Language } from "./language"

// The public pages Vercel serves from its cache (#286, ADR 0006). Each is
// built once per language state, under /by-language/<state>, and a rewrite
// in next.config.ts picks the copy from the `lang` cookie before any function
// runs. The address bar keeps the public address.
//
// The three states match what a page read from the cookie before: no `lang`
// cookie (Swahili, with the first-visit language card), `lang=en` (English),
// and any other value (Swahili, no card).

export const LANGUAGE_STATES = ["first", "sw", "en"] as const

export type LanguageState = (typeof LANGUAGE_STATES)[number]

export const LANGUAGE_STATE_PREFIX = "/by-language"

// The public addresses served this way. The language switch sends a visitor
// back to one of these after setting the cookie, so the next request picks
// the other copy.
export const CACHED_PUBLIC_PATHS = ["/"] as const

export type CachedPublicPath = (typeof CACHED_PUBLIC_PATHS)[number]

export function isCachedPublicPath(value: unknown): value is CachedPublicPath {
  return typeof value === "string" && (CACHED_PUBLIC_PATHS as readonly string[]).includes(value)
}

export function isLanguageState(value: unknown): value is LanguageState {
  return typeof value === "string" && (LANGUAGE_STATES as readonly string[]).includes(value)
}

export function languageOfState(state: LanguageState): Language {
  return state === "en" ? "en" : DEFAULT_LANGUAGE
}

// No `lang` cookie yet: the first-visit language card shows.
export function promptNeededInState(state: LanguageState): boolean {
  return state === "first"
}

// The copy a public path is built at for one state: `/` in English is
// /by-language/en, `/apply` is /by-language/en/apply.
export function statePath(state: LanguageState, path: CachedPublicPath): string {
  return `${LANGUAGE_STATE_PREFIX}/${state}${path === "/" ? "" : path}`
}

type CookieCondition = { type: "cookie"; key: string; value?: string }
type Rewrite = { source: string; destination: string; has?: CookieCondition[]; missing?: CookieCondition[] }

// Checked in order, first match wins: English, then any other `lang` value,
// then no cookie. Next.js anchors a `has` value as a whole-value regular
// expression, so `english` or `en-GB` is "any other value", as it was for
// getLanguage().
export function languageStateRewrites(): Rewrite[] {
  return CACHED_PUBLIC_PATHS.flatMap((path) => [
    { source: path, has: [{ type: "cookie", key: LANGUAGE_COOKIE, value: "en" }], destination: statePath("en", path) },
    { source: path, has: [{ type: "cookie", key: LANGUAGE_COOKIE }], destination: statePath("sw", path) },
    { source: path, missing: [{ type: "cookie", key: LANGUAGE_COOKIE }], destination: statePath("first", path) },
  ])
}
