import "server-only"

import { cookies } from "next/headers"

import { LANGUAGE_COOKIE } from "@/lib/language"

/**
 * True when the request carries no `lang` cookie, so the page should show the
 * first-visit language card. Either choice on the card sets the cookie
 * through `setLanguage`, so the card shows once per browser.
 */
export async function languagePromptNeeded(): Promise<boolean> {
  return !(await cookies()).has(LANGUAGE_COOKIE)
}
