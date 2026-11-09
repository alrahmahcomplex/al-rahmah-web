import { randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { family, fillChild, fillParent, WORDS as APPLY, waitForSecurityCheck } from "./admission-form"
import { fillRegistration, newcomer, WORDS as DISCOUNT } from "./discount-code"

// Where Cloudflare's security check sits on the public forms. It stays
// invisible while Cloudflare passes the visitor on its own (the always-pass
// test key), so nothing near the Interview fee looks like a payment. When
// Cloudflare needs a click, the box shows above Send, centred inside the card
// and never wider than it, and Send brings it into view with words saying
// what to do. The click case uses a stand-in for Cloudflare's script that
// asks for a click and draws a box of Turnstile's documented sizes:
// flexible is 100% wide with a 300px minimum, compact is 150 × 140.

const VIEWPORTS = [
  { name: "phone", size: { width: 390, height: 844 } },
  { name: "desktop", size: { width: 1280, height: 800 } },
] as const

const NEEDS_CLICK = {
  sw: "Weka alama kwenye ukaguzi wa usalama hapa chini, kisha utume.",
  en: "Tick the security check below, then send.",
}

async function cloudflareAsksForAClick(page: Page) {
  await page.addInitScript(() => {
    type Options = { size: "flexible" | "compact"; "before-interactive-callback": () => void }
    Object.assign(window, {
      turnstile: {
        render(container: HTMLElement, options: Options) {
          const box = document.createElement("div")
          box.dataset.fakeCheck = options.size
          Object.assign(
            box.style,
            options.size === "compact"
              ? { width: "150px", height: "140px", flexShrink: "0" }
              : { width: "100%", minWidth: "300px", height: "65px" },
          )
          container.appendChild(box)
          setTimeout(() => options["before-interactive-callback"](), 0)
          box.id = `fake-check-${Math.random().toString(36).slice(2)}`
          return box.id
        },
        reset() {},
        // Like Turnstile, removing a widget takes its box away.
        remove(id: string) {
          document.getElementById(id)?.remove()
        },
      },
    })
  })
}

// Cloudflare's test site key that always asks for a click. The page's
// always-pass key is built into it, so this one is swapped in as the widget
// is drawn.
const FORCED_INTERACTION_SITE_KEY = "3x00000000000000000000FF"

// Cloudflare's own script, counting each widget drawn in
// `window.checksDrawn`, and drawing with `sitekey` when given.
async function watchRealCheck(page: Page, sitekey?: string) {
  await page.addInitScript((sitekey) => {
    type Render = (container: HTMLElement, options: Record<string, unknown>) => unknown
    let real: { render: Render } | undefined
    Object.assign(window, { checksDrawn: 0 })
    Object.defineProperty(window, "turnstile", {
      configurable: true,
      get: () => real,
      set(value: { render: Render }) {
        const render = value.render.bind(value)
        value.render = (container, options) => {
          Object.assign(window, { checksDrawn: (window as unknown as { checksDrawn: number }).checksDrawn + 1 })
          return render(container, sitekey ? { ...options, sitekey } : options)
        }
        real = value
      },
    })
  }, sitekey)
}

const checksDrawn = (page: Page) => page.evaluate(() => (window as unknown as { checksDrawn: number }).checksDrawn)

// A stand-in for Cloudflare's script that fails every try, as on a network
// that blocks challenges.cloudflare.com part-way.
async function cloudflareKeepsFailing(page: Page) {
  await page.addInitScript(() => {
    type Options = { "error-callback": (code: string) => boolean }
    Object.assign(window, {
      turnstile: {
        render(_container: HTMLElement, options: Options) {
          setTimeout(() => options["error-callback"]("300010"), 0)
          setTimeout(() => options["error-callback"]("300010"), 50)
          return "failing-check"
        },
        reset() {},
        remove() {},
      },
    })
  })
}

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
}

// The white rounded card around the check, and the check's drawn box.
async function boxAndCard(page: Page) {
  return page.locator("[data-turnstile-box]").evaluate((container) => {
    let card: Element | null = container.parentElement
    while (card && !(getComputedStyle(card).backgroundColor === "rgb(255, 255, 255)" && parseFloat(getComputedStyle(card).borderTopLeftRadius) >= 30)) {
      card = card.parentElement
    }
    const inner = container.firstElementChild ?? container
    const rect = (element: Element) => {
      const { left, right, top, bottom, height } = element.getBoundingClientRect()
      return { left, right, top, bottom, height }
    }
    const style = card ? getComputedStyle(card) : null
    const cardRect = card ? rect(card) : null
    return {
      box: rect(inner),
      container: rect(container),
      // The card's content edges, inside its padding.
      content: cardRect && style && {
        left: cardRect.left + parseFloat(style.paddingLeft),
        right: cardRect.right - parseFloat(style.paddingRight),
      },
    }
  })
}

async function expectInsideCardAndCentred(page: Page) {
  const { box, content } = await boxAndCard(page)
  expect(content).not.toBeNull()
  expect(box.left).toBeGreaterThanOrEqual(content!.left - 0.5)
  expect(box.right).toBeLessThanOrEqual(content!.right + 0.5)
  const offCentre = Math.abs((box.left + box.right) / 2 - (content!.left + content!.right) / 2)
  expect(offCentre).toBeLessThanOrEqual(1)
}

async function expectSendBringsCheckIntoView(page: Page, lang: "sw" | "en", send: string) {
  const message = page.getByText(NEEDS_CLICK[lang])
  await expect(message).toBeVisible()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.getByRole("button", { name: send }).click()
  await expect(message).toBeFocused()
  await expect(message).toBeInViewport()
  await expect(page.locator("[data-fake-check]")).toBeInViewport()
  // The check speaks for itself, so the form's "wait a moment" stays away.
  await expect(page.getByText(/Wait a moment for the security check|Subiri ukaguzi wa usalama/)).toHaveCount(0)
}

async function reachReviewStep(page: Page, lang: "sw" | "en") {
  const t = APPLY[lang]
  await page.goto("/apply")
  await fillParent(page, lang, family())
  await page.getByRole("button", { name: t.continue }).click()
  await fillChild(page, lang, family(), String(admissionYears()[1]))
  await page.getByRole("button", { name: t.continue }).click()
  await expect(page.getByRole("heading", { level: 1, name: t.steps[2] })).toBeVisible()
}

for (const { name, size } of VIEWPORTS) {
  test.describe(`on a ${name} (${size.width}px)`, () => {
    test.use({ viewport: size })

    test("the Admission review step shows no check while Cloudflare passes, and says nothing is paid", async ({ page }) => {
      await reachReviewStep(page, "sw")
      await waitForSecurityCheck(page)
      const { container } = await boxAndCard(page)
      expect(container.height).toBeLessThanOrEqual(1)
      await expect(page.getByText("Hulipi chochote kwenye fomu hii.")).toBeVisible()
      await noSidewaysScroll(page)
    })

    test("the forgot-password card shows no check while Cloudflare passes", async ({ page }) => {
      await page.goto("/login/forgot-password")
      await waitForSecurityCheck(page)
      const { container } = await boxAndCard(page)
      expect(container.height).toBeLessThanOrEqual(1)
      await noSidewaysScroll(page)
    })

    for (const lang of ["sw", "en"] as const) {
      test(`a check that needs a click sits inside the forgot-password card, in ${lang}`, async ({ page, baseURL }) => {
        if (lang === "en") await page.context().addCookies([{ name: "lang", value: "en", url: baseURL! }])
        await cloudflareAsksForAClick(page)
        await page.goto("/login/forgot-password")
        await page.getByRole("textbox").fill("mzazi@example.test")
        await expect(page.getByText(NEEDS_CLICK[lang])).toBeVisible()
        await expectInsideCardAndCentred(page)
        await noSidewaysScroll(page)
        await expectSendBringsCheckIntoView(page, lang, lang === "sw" ? "Tuma kiungo kipya" : "Send a new link")
      })

      test(`a check that needs a click sits above Send on the Admission review step, in ${lang}`, async ({ page, baseURL }) => {
        if (lang === "en") await page.context().addCookies([{ name: "lang", value: "en", url: baseURL! }])
        await cloudflareAsksForAClick(page)
        await reachReviewStep(page, lang)
        await expect(page.getByText(NEEDS_CLICK[lang])).toBeVisible()
        await expectInsideCardAndCentred(page)
        await noSidewaysScroll(page)
        // Below the fee box and above Send.
        const fee = await page.getByText(lang === "sw" ? "Ada ya usaili" : "Interview fee").boundingBox()
        const check = await page.locator("[data-fake-check]").boundingBox()
        const send = await page.getByRole("button", { name: APPLY[lang].send }).boundingBox()
        expect(check!.y).toBeGreaterThan(fee!.y)
        expect(check!.y + check!.height).toBeLessThan(send!.y)
        await expectSendBringsCheckIntoView(page, lang, APPLY[lang].send)
      })
    }

    test("a check that needs a click sits inside the Discount code card", async ({ page }) => {
      await cloudflareAsksForAClick(page)
      await page.goto("/discount-code")
      await fillRegistration(page, "sw", newcomer())
      await expectInsideCardAndCentred(page)
      await noSidewaysScroll(page)
      await expectSendBringsCheckIntoView(page, "sw", DISCOUNT.sw.send)
    })

    test("a password link request still sends with the always-pass keys", async ({ page }) => {
      await page.goto("/login/forgot-password")
      await waitForSecurityCheck(page)
      await page.getByRole("textbox").fill(`hakuna-akaunti-${randomUUID().slice(0, 8)}@example.test`)
      await page.getByRole("button", { name: "Tuma kiungo kipya" }).click()
      await expect(page.getByRole("status")).toContainText("Kama barua pepe hii ina akaunti", { timeout: 15_000 })
    })
  })
}

test.describe("the sign-in card", () => {
  for (const { name, size } of VIEWPORTS) {
    test(`on a ${name}, the hidden check leaves no gap above Ingia (#273)`, async ({ page }) => {
      await page.setViewportSize(size)
      await page.goto("/login")
      await waitForSecurityCheck(page)
      const password = await page.getByLabel("Nenosiri", { exact: true }).boundingBox()
      const ingia = await page.getByRole("button", { name: "Ingia" }).boundingBox()
      // The same 12px as between the two boxes.
      expect(Math.round(ingia!.y - (password!.y + password!.height))).toBe(12)
    })

    test(`on a ${name}, Ingia before the check is ticked keeps the email and password (#273)`, async ({ page }) => {
      await page.setViewportSize(size)
      await watchRealCheck(page, FORCED_INTERACTION_SITE_KEY)
      await page.goto("/login")
      await page.getByLabel("Barua pepe").fill("mzazi@example.test")
      await page.getByLabel("Nenosiri", { exact: true }).fill("a-password")
      await expect(page.getByText(NEEDS_CLICK.sw)).toBeVisible({ timeout: 20_000 })
      await expectInsideCardAndCentred(page)
      await noSidewaysScroll(page)

      await page.getByRole("button", { name: "Ingia" }).click()
      await expect(page.getByText(NEEDS_CLICK.sw)).toBeFocused()
      await expect(page.getByLabel("Barua pepe")).toHaveValue("mzazi@example.test")
      await expect(page.getByLabel("Nenosiri", { exact: true })).toHaveValue("a-password")
      await expect(page.getByText(/Subiri ukaguzi wa usalama/)).toHaveCount(0)
      await expect(page).toHaveURL(/\/login$/)
    })
  }

  test("a check that keeps failing says it couldn't load, and Ingia points to it (#272)", async ({ page }) => {
    await cloudflareKeepsFailing(page)
    await page.goto("/login")
    const alert = page.locator("form").getByRole("alert")
    await expect(alert).toHaveText("Ukaguzi wa usalama haukuweza kufunguka. Pakia ukurasa upya kisha ujaribu tena.")
    await page.getByLabel("Barua pepe").fill("mzazi@example.test")
    await page.getByLabel("Nenosiri", { exact: true }).fill("a-password")
    await page.getByRole("button", { name: "Ingia" }).click()
    await expect(alert).toBeFocused()
    await expect(page.getByLabel("Barua pepe")).toHaveValue("mzazi@example.test")
  })
})

test("a check that passed out of sight keeps its token when the window narrows (#272)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await watchRealCheck(page)
  await reachReviewStep(page, "sw")
  await waitForSecurityCheck(page)
  expect(await checksDrawn(page)).toBe(1)

  // A small phone: the card's inside drops under Turnstile's 300px minimum,
  // but the invisible widget isn't drawn again, so its token stays.
  await page.setViewportSize({ width: 340, height: 800 })
  await page.waitForTimeout(1_000)
  expect(await checksDrawn(page)).toBe(1)
  await waitForSecurityCheck(page)
  await noSidewaysScroll(page)
})

test("a check that needs a click is drawn again to fit when the window narrows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await cloudflareAsksForAClick(page)
  await reachReviewStep(page, "sw")
  await expect(page.locator('[data-fake-check="flexible"]')).toBeVisible()

  // A small phone: the card's inside drops under Turnstile's 300px minimum.
  await page.setViewportSize({ width: 340, height: 800 })
  await expect(page.locator('[data-fake-check="compact"]')).toBeVisible()
  await expect(page.locator('[data-fake-check="flexible"]')).toHaveCount(0)
  await expect(page.getByText(NEEDS_CLICK.sw)).toBeVisible()
  await expectInsideCardAndCentred(page)
  await noSidewaysScroll(page)
})
