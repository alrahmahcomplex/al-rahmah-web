import { expect, test } from "@playwright/test"

import { E2E_PORT } from "./server"

// The public pages served from one prerendered copy per language state (#286,
// ADR 0006): the `lang` cookie picks the copy, the copies hold nothing that
// belongs to one visitor, and the session pages stay per request.

const CACHED = ["/", "/apply", "/login/forgot-password"] as const

// What each page says in its first HTML in Swahili and in English.
const WORDS: Record<(typeof CACHED)[number], { sw: string; en: string }> = {
  "/": { sw: "Omba sasa", en: "Apply now" },
  "/apply": { sw: "Mwanafunzi anaitwa nani?", en: "What is the student&#x27;s name?" },
  "/login/forgot-password": { sw: "Umesahau nenosiri?", en: "Forgot your password?" },
}

test.describe("pages served from a prerendered copy", () => {
  for (const path of CACHED) {
    test(`${path}: the lang cookie picks the copy, an unknown value is Swahili`, async ({ request }) => {
      const words = WORDS[path]
      for (const [cookie, lang] of [
        [undefined, "sw"],
        ["lang=en", "en"],
        ["lang=sw", "sw"],
        ["lang=fr", "sw"],
        ["lang=english", "sw"],
      ] as const) {
        const response = await request.get(path, { headers: cookie ? { cookie } : {} })
        expect(response.status(), `${path} with ${cookie ?? "no cookie"}`).toBe(200)
        const html = await response.text()
        expect(html, `${path} with ${cookie ?? "no cookie"}`).toMatch(new RegExp(`<main[^>]* lang="${lang}"`))
        expect(html).toContain(words[lang])
        expect(html).not.toContain(words[lang === "sw" ? "en" : "sw"])
        // Built ahead of time, so the CDN may keep it.
        expect(response.headers()["cache-control"]).not.toMatch(/private|no-store/)
      }
    })
  }

  test("the copy of /apply opened from a Referral link holds no Discount code", async ({ request }) => {
    for (const cookie of [undefined, "lang=en", "lang=sw"]) {
      const response = await request.get("/apply?ref=BJN-402", {
        headers: { cookie: [cookie, "discount_code=ZERO26"].filter(Boolean).join("; ") },
      })
      const html = await response.text()
      expect(html).toMatch(/<main[^>]* lang="/)
      expect(html).not.toContain("BJN-402")
      expect(html).not.toContain("ZERO26")
    }
  })

  test("a copy opened by its own address goes to the public address", async ({ request }) => {
    for (const [copy, path] of [
      ["/by-language/en", "/"],
      ["/by-language/first", "/"],
      ["/by-language/sw/apply", "/apply"],
      ["/by-language/en/login/forgot-password", "/login/forgot-password"],
    ]) {
      const response = await request.get(copy, { maxRedirects: 0 })
      expect(response.status(), copy).toBe(307)
      expect(new URL(response.headers().location, "http://x").pathname).toBe(path)
    }
  })

  test("switching language on /apply keeps the form mounted, from a first visit on", async ({ page }) => {
    await page.goto("/apply")
    // The first-visit card: keep Swahili, which sets the cookie the copy wasn't built for.
    await page.getByRole("button", { name: "Endelea kwa Kiswahili" }).click()
    await expect(page.getByText("Karibu!")).toBeHidden({ timeout: 10_000 })

    const field = page.getByRole("textbox", { name: "Mwanafunzi anaitwa nani?" })
    await field.fill("Neema Mfano")
    await field.evaluate((input) => (input.dataset.mark = "same"))

    for (const [lang, label, question, title] of [
      ["en", "English", "What is the student's name?", "Admission Form · Al-Rahmah Complex"],
      ["sw", "Kiswahili", "Mwanafunzi anaitwa nani?", "Fomu ya Udahili · Al-Rahmah Complex"],
    ] as const) {
      // The menu stays open after a switch.
      if (await page.locator(".gf-menu").isHidden()) await page.locator("button.gf-menubtn").click()
      await page.locator(".gf-menu").getByRole("button", { name: label }).click()
      await expect(page.getByRole("main")).toHaveAttribute("lang", lang)
      const input = page.getByRole("textbox", { name: question })
      await expect(input).toHaveValue("Neema Mfano")
      // The same element: React didn't remount the form.
      await expect(input).toHaveAttribute("data-mark", "same")
      await expect(page).toHaveTitle(title)
    }
  })

  test("switching language on /login/forgot-password keeps the email typed", async ({ page, context }) => {
    await context.addCookies([{ name: "lang", value: "sw", url: "http://localhost:" + E2E_PORT }])
    await page.goto("/login/forgot-password")
    const email = page.getByRole("textbox").first()
    await email.fill("someone@example.test")
    await page.getByRole("button", { name: "English" }).click()
    await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible()
    await expect(page.getByRole("textbox").first()).toHaveValue("someone@example.test")
    await expect(page).toHaveTitle("Forgot your password? · Al-Rahmah Complex")
  })

  test("a switch on a page rendered per request wins over an earlier in-place switch", async ({ page, context }) => {
    await context.addCookies([{ name: "lang", value: "sw", url: "http://localhost:" + E2E_PORT }])
    await page.goto("/login/forgot-password")
    await page.getByRole("button", { name: "English" }).click()
    await expect(page.getByRole("heading", { name: "Forgot your password?" })).toBeVisible()

    await page.getByRole("link", { name: "Go to sign-in" }).click()
    await expect(page).toHaveURL(/\/login$/)
    await page.getByRole("button", { name: "Kiswahili" }).click()
    await expect(page.getByRole("main")).toHaveAttribute("lang", "sw")

    await page.getByRole("link", { name: "Umesahau nenosiri?" }).click()
    await expect(page).toHaveURL(/\/login\/forgot-password$/)
    await expect(page.getByRole("heading", { name: "Umesahau nenosiri?" })).toBeVisible()
    await expect(page.getByRole("main")).toHaveAttribute("lang", "sw")
  })

  test("the session pages still answer private, no-store", async ({ request }) => {
    for (const path of ["/login", "/login/reset-password", "/discount-code"]) {
      const response = await request.get(path, { maxRedirects: 0 })
      expect(response.headers()["cache-control"], path).toMatch(/no-store/)
    }
  })
})
