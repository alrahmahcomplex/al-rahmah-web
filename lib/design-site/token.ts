// The design site's password (DESIGN_SITE_PASSWORD) and the cookie that
// remembers a browser that gave it. next.config.ts imports this file, so it
// uses no "@/" imports.
//
// The cookie holds a token made from the password, never the password. The
// routing layer lets a request through to the design pages only when its
// cookie equals the token (lib/site-hosts.ts, designGateRewrites), so the
// pages themselves stay static and fast. Changing the password changes the
// token: every browser has to give the new one.

import { createHmac, timingSafeEqual } from "node:crypto"

export { DESIGN_COOKIE, DESIGN_COOKIE_MAX_AGE } from "./cookie"

/** The password, or null when the site is not set up (it then stays locked). */
export function designPassword(env: Record<string, string | undefined> = process.env): string | null {
  const value = env.DESIGN_SITE_PASSWORD?.trim()
  return value ? value : null
}

/** The cookie's value for a password: 64 hex characters, safe in a routing rule. */
export function designToken(password: string): string {
  return createHmac("sha256", password).update("al-rahmah design site, browser token, v1").digest("hex")
}

/** Whether `given` is the password, in time that does not depend on where they differ. */
export function isDesignPassword(given: string | null | undefined, password: string | null): boolean {
  if (!password || typeof given !== "string") return false
  // Compare fixed-length digests, so neither the length nor the content leaks through timing.
  const a = createHmac("sha256", "compare").update(given).digest()
  const b = createHmac("sha256", "compare").update(password).digest()
  return timingSafeEqual(a, b)
}
