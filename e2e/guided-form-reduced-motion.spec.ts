import { expect, test, type Page } from "@playwright/test"

import { family, openQuestion as openApplyQuestion, setLanguageCookie, WORDS as APPLY } from "./admission-form"
import { chooseLanguage, newcomer, openQuestion as openCodeQuestion, WORDS as CODE } from "./discount-code"

// #334: with reduced motion on, the first question of each guided form
// stayed folded at 1px. The server drew it about to unfold; the browser,
// knowing about reduced motion, hydrated it already open, and the server's
// class stuck. These load each form as a phone that asks for less motion and
// answer the first question.

test.use({ reducedMotion: "reduce" })

// React reports a hydration mismatch as a console error (minified #418,
// #423 and #425 in a production build).
function watchHydration(page: Page) {
  const errors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error" && /hydrat|#418|#423|#425/i.test(m.text())) errors.push(m.text())
  })
  page.on("pageerror", (e) => {
    if (/hydrat|#418|#423|#425/i.test(e.message)) errors.push(e.message)
  })
  return errors
}

for (const viewport of [
  { width: 390, height: 844 },
  { width: 1280, height: 800 },
]) {
  test(`Admission form: the first question shows and can be answered at ${viewport.width}px`, async ({ page, context }) => {
    await page.setViewportSize(viewport)
    await setLanguageCookie(context, "sw")
    const errors = watchHydration(page)
    await page.goto("/apply")

    const q = openApplyQuestion(page)
    await expect(q.getByRole("textbox")).toBeVisible()
    expect((await q.boundingBox())?.height).toBeGreaterThan(50)

    await q.getByRole("textbox").fill(family().child)
    await q.getByRole("button", { name: APPLY.sw.continue }).click()
    await expect(openApplyQuestion(page).getByRole("button", { name: APPLY.sw.chooseOther })).toBeVisible()
    expect(errors).toEqual([])
  })

  test(`Discount code form: the first question shows and can be answered at ${viewport.width}px`, async ({ page, context }) => {
    await page.setViewportSize(viewport)
    await chooseLanguage(context, "sw")
    const errors = watchHydration(page)
    await page.goto("/discount-code")

    const q = openCodeQuestion(page)
    await expect(page.getByLabel(CODE.sw.name)).toBeVisible()
    expect((await q.boundingBox())?.height).toBeGreaterThan(50)

    await page.getByLabel(CODE.sw.name).fill(newcomer().name)
    await q.getByRole("button", { name: CODE.sw.next }).click()
    await expect(page.getByLabel(CODE.sw.phone)).toBeVisible()
    expect(errors).toEqual([])
  })
}

