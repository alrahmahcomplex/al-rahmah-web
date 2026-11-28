import type { Page } from "@playwright/test"

import { DESIGN_COOKIE } from "../lib/design-site/cookie"
import { designToken } from "../lib/design-site/token"
import { E2E_PORT } from "./server"

// The design site in browser tests (design site, prototype v6). The test
// server reads DESIGN_SITE_PASSWORD from .env.local, which comes from
// .env.example, so the tests know it too.
export const DESIGN_PASSWORD = process.env.DESIGN_SITE_PASSWORD?.trim() || "sample-password"

/** Gives this browser the cookie a right password leaves, so the design pages open. */
export async function unlockDesign(page: Page, port: number = E2E_PORT) {
  await page.context().addCookies([{ name: DESIGN_COOKIE, value: designToken(DESIGN_PASSWORD), url: `http://localhost:${port}` }])
}

/** Opens a design page (/design locally) in an unlocked browser. */
export async function openDesign(page: Page, path = "/design") {
  await unlockDesign(page)
  await page.goto(path)
}
