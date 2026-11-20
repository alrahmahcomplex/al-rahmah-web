import { ADMISSIONS } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// Only the Admissions Portal installs as an app (#497 slice B). Locally every
// page is on one host, so the portal's pages carry the install tags and the
// public pages carry none, as they do on their production hosts.

const INSTALL_TAG = /<link rel="manifest"|<meta name="(mobile-web-app-capable|apple-mobile-web-app-[a-z-]+)"/

const PUBLIC_PAGES = ["/", "/apply", "/apply?ref=BJN-402"]
const PORTAL_PAGES = ["/login", "/login/forgot-password", "/login/reset-password", "/auth/confirm", "/discount-code"]

test.describe("install as an app", () => {
  for (const path of PUBLIC_PAGES) {
    test(`public ${path} offers no install`, async ({ request }) => {
      for (const cookie of [undefined, "lang=en", "lang=sw"]) {
        const html = await (await request.get(path, { headers: cookie ? { cookie } : {} })).text()
        expect(html, `${path} with ${cookie ?? "no cookie"}`).toMatch(/<main[^>]*>/)
        expect(html, `${path} with ${cookie ?? "no cookie"}`).not.toMatch(INSTALL_TAG)
      }
    })
  }

  for (const path of PORTAL_PAGES) {
    test(`portal ${path} links the manifest and the Apple web-app tags`, async ({ request }) => {
      const html = await (await request.get(path)).text()
      expect(html).toContain('<link rel="manifest" href="/manifest.webmanifest"')
      expect(html).toMatch(/<meta name="mobile-web-app-capable" content="yes"/)
      expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="Al-Rahmah"/)
    })
  }

  test("a signed-in staff page links the manifest", async ({ page }) => {
    await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
    await page.goto("/staff")
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest")
    await expect(page.locator('meta[name="apple-mobile-web-app-title"]')).toHaveAttribute("content", "Al-Rahmah")
  })

  test("the manifest opens the portal's sign-in", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest")
    expect(response.status()).toBe(200)
    expect(response.headers()["content-type"]).toContain("application/manifest+json")
    expect(await response.json()).toMatchObject({ id: "/", start_url: "/login", scope: "/", display: "standalone" })
  })
})
