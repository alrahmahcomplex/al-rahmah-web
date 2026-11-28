"use server"

import { cookies, headers } from "next/headers"

import { addressOf } from "@/lib/design-site/access"
import { DESIGN_COOKIE, DESIGN_COOKIE_MAX_AGE, designPassword, designToken, isDesignPassword } from "@/lib/design-site/token"
import { designTries } from "@/lib/design-site/tries"
import { checkPublicFormLimit } from "@/lib/rate-limit"

// The design site's lock (design site, prototype v6). No database: the
// password lives in DESIGN_SITE_PASSWORD, and a browser that gave it keeps a
// cookie holding its token for 30 days. The routing layer reads the cookie
// (lib/site-hosts.ts, designGateRewrites), so these actions only set and
// clear it.

export type UnlockResult = { ok: true } | { ok: false; error: "empty" | "wrong" | "tries" | "unset" }

/** Opens the design pages in this browser for 30 days when the password is right. */
export async function unlockDesign(given: string): Promise<UnlockResult> {
  const password = designPassword()
  if (!password) return { ok: false, error: "unset" }
  const typed = typeof given === "string" ? given.trim() : ""
  if (!typed) return { ok: false, error: "empty" }

  const requestHeaders = await headers()
  const address = addressOf(requestHeaders)
  if (designTries.blocked(address)) return { ok: false, error: "tries" }
  // The firewall's shared limit for public forms, across every server instance.
  if ((await checkPublicFormLimit({ headers: requestHeaders, key: "design-unlock" })) === "limited") return { ok: false, error: "tries" }

  if (!isDesignPassword(typed, password)) {
    designTries.wrong(address)
    return { ok: false, error: designTries.blocked(address) ? "tries" : "wrong" }
  }
  designTries.clear(address)
  const cookieStore = await cookies()
  cookieStore.set(DESIGN_COOKIE, designToken(password), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: DESIGN_COOKIE_MAX_AGE,
  })
  return { ok: true }
}

/** Locks the design pages in this browser again. */
export async function lockDesign(): Promise<void> {
  const cookieStore = await cookies()
  cookieStore.delete(DESIGN_COOKIE)
}

/**
 * The password, for the Connect an AI page's copy buttons, and only for a
 * browser whose cookie already holds its token: the static page never
 * carries it.
 */
export async function designKeyForThisBrowser(): Promise<string | null> {
  const password = designPassword()
  if (!password) return null
  const cookieStore = await cookies()
  return cookieStore.get(DESIGN_COOKIE)?.value === designToken(password) ? password : null
}
