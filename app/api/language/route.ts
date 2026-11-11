import { cookies } from "next/headers"

import { languageCookieOptions } from "@/lib/language"
import { isLanguage, LANGUAGE_COOKIE } from "@/lib/languages"

// The in-place language switch on the pages served from Vercel's cache
// (components/page-language.tsx, ADR 0006). It sets the same `lang` cookie as
// the switch's Server Action. A Server Action that sets a cookie makes
// Next.js render the current page again, and on these pages that render is
// the copy for the cookie the request carried, so the form would remount.
// A plain POST changes nothing on the page. Outside proxy.ts's matcher.
export async function POST(request: Request): Promise<Response> {
  let lang: unknown
  try {
    lang = (await request.formData()).get("lang")
  } catch {
    lang = null
  }
  if (!isLanguage(lang)) return new Response(null, { status: 400 })

  ;(await cookies()).set(LANGUAGE_COOKIE, lang, languageCookieOptions())
  return new Response(null, { status: 204, headers: { "Cache-Control": "private, no-store" } })
}
