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

test("a check that needs a click is drawn again to fit when the window narrows", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await cloudflareAsksForAClick(page)
  await reachReviewStep(page, "sw")
  await expect(page.locator('[data-fake-check="flexible"]')).toBeVisible()

  // A small phone: the card's inside drops under Turnstile's 300px minimum.
  await page.setViewportSize({ width: 340, height: 800 })
  await expect(page.locator('[data-fake-check="compact"]')).toBeVisible()
  await expect(page.getByText(NEEDS_CLICK.sw)).toBeVisible()
  await expectInsideCardAndCentred(page)
  await noSidewaysScroll(page)
})
