import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { family, fillChild, fillParent, PHONE_WIDTH, waitForSecurityCheck, WORDS } from "./admission-form"
import { E2E_PORT } from "./server"

// The Admission form's history entries and its sessionStorage draft (#255):
// the phone's Back and Forward move between steps, a reload keeps the
// entries, and a confirmed send leaves nothing behind. Also every problem on
// a step at once, and the header with the phone's text made large.

test.use({ viewport: PHONE_WIDTH })

const t = WORDS.sw
const nextYear = String(admissionYears()[1])

const heading = (page: Page, step: 0 | 1 | 2) => page.getByRole("heading", { level: 1, name: t.steps[step] })

test("Back, Forward and reload keep every entry, and a confirmed send clears them", async ({ page }) => {
  const who = family()
  const ref = `MJ-${who.phone.slice(-6)}`
  await page.goto(`/apply?ref=${ref}`)
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: t.continue }).click()
  await expect(heading(page, 1)).toBeVisible()
  await expect(page).toHaveURL(`/apply?ref=${ref}&step=2`)
  await page.getByLabel(t.childName).fill(who.child)
  await page.getByRole("button", { name: "STD 3", exact: true }).click()

  await page.goBack()
  await expect(heading(page, 0)).toBeVisible()
  await expect(page).toHaveURL(`/apply?ref=${ref}`)
  await expect(page.getByLabel(t.parentName)).toHaveValue(who.parent)
  await expect(page.getByLabel(t.phone, { exact: true })).toHaveValue(who.phone)

  await page.goForward()
  await expect(heading(page, 1)).toBeVisible()
  await expect(page.getByLabel(t.childName)).toHaveValue(who.child)
  await expect(page.getByRole("button", { name: "STD 3", exact: true })).toHaveAttribute("aria-pressed", "true")

  await page.reload()
  await expect(heading(page, 1)).toBeVisible()
  await expect(page.getByLabel(t.childName)).toHaveValue(who.child)
  await expect(page.getByRole("button", { name: "STD 3", exact: true })).toHaveAttribute("aria-pressed", "true")

  // Problems on the step leave its history entry alone, and the form's own
  // Back steps back through history, so Forward still works.
  await page.getByRole("button", { name: t.continue }).click()
  await expect(page.getByText("Chagua mwaka wa kujiunga.")).toBeVisible()
  await page.getByRole("button", { name: t.back }).click()
  await expect(heading(page, 0)).toBeVisible()
  await expect(page.getByRole("button", { name: t.mother, exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.goForward()
  await expect(heading(page, 1)).toBeVisible()
  await expect(page.getByLabel(t.childName)).toHaveValue(who.child)

  await page.getByRole("button", { name: nextYear, exact: true }).click()
  await page.getByRole("button", { name: t.boarding, exact: true }).click()
  await page.getByRole("button", { name: t.continue }).click()
  await expect(heading(page, 2)).toBeVisible()

  // The parent clears the link's code; a reload of the same link keeps that.
  const code = page.getByLabel("Code ya Punguzo · si lazima")
  await expect(code).toHaveValue(ref)
  await code.fill("")
  await page.reload()
  await expect(heading(page, 2)).toBeVisible()
  await expect(code).toHaveValue("")

  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: t.send }).click()
  await expect(page.getByRole("heading", { name: "Maombi yamepokelewa!" })).toBeVisible()
  expect(await page.evaluate(() => window.sessionStorage.length)).toBe(0)

  await page.reload()
  await expect(heading(page, 0)).toBeVisible()
  await expect(page.getByLabel(t.parentName)).toHaveValue("")
  await expect(page.getByRole("button", { name: t.mother, exact: true })).toHaveAttribute("aria-pressed", "false")
})

test("switching language on a later step keeps the form's Back in history", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: t.continue }).click()
  await expect(heading(page, 1)).toBeVisible()
  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByRole("heading", { level: 1, name: WORDS.en.steps[1] })).toBeVisible()
  await page.getByRole("button", { name: WORDS.en.back }).click()
  await expect(page.getByRole("heading", { level: 1, name: WORDS.en.steps[0] })).toBeVisible()
  await page.goForward()
  await expect(page.getByRole("heading", { level: 1, name: WORDS.en.steps[1] })).toBeVisible()
})

test("a later step opened directly, with no draft, opens the first step instead", async ({ page }) => {
  await page.goto("/apply?step=3")
  await expect(heading(page, 0)).toBeVisible()
  await expect(page).toHaveURL(/\/apply$/)
})

test("with storage blocked, the form still sends", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError")
      },
    })
  })
  const who = family()
  await page.goto("/apply")
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: t.continue }).click()
  await fillChild(page, "sw", who, nextYear)
  await page.getByRole("button", { name: t.continue }).click()
  await expect(heading(page, 2)).toBeVisible()
  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: t.send }).click()
  await expect(page.getByRole("heading", { name: "Maombi yamepokelewa!" })).toBeVisible()
  await expect(page.getByText(/^ADMSN-\d{5}$/)).toBeVisible()
})

test("an empty Continue names every missing field at once and focuses the first", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await page.getByRole("button", { name: t.continue }).click()
  await expect(page.getByText("Andika jina kamili la mzazi au mlezi.")).toBeVisible()
  await expect(page.getByText("Chagua uhusiano wako na mtoto.")).toBeVisible()
  await expect(page.getByText("Andika namba yako ya simu.")).toBeVisible()
  await expect(page.getByLabel(t.parentName)).toBeFocused()

  // Fixing one field leaves the others named.
  await page.getByLabel(t.parentName).fill(who.parent)
  await expect(page.getByText("Andika jina kamili la mzazi au mlezi.")).toHaveCount(0)
  await expect(page.getByText("Andika namba yako ya simu.")).toBeVisible()

  await page.getByRole("button", { name: t.mother, exact: true }).click()
  await page.getByLabel(t.phone, { exact: true }).fill(who.phone)
  await page.getByRole("button", { name: t.continue }).click()
  await page.getByRole("button", { name: "Ongeza mtoto mwingine" }).click()
  await page.getByRole("button", { name: t.continue }).click()

  for (const card of ["Mtoto 1", "Mtoto 2"]) {
    const group = page.getByRole("group", { name: card })
    await expect(group.getByText("Andika jina kamili la mtoto.")).toBeVisible()
    await expect(group.getByText("Chagua darasa analoomba.")).toBeVisible()
    await expect(group.getByText("Chagua mwaka wa kujiunga.")).toBeVisible()
    await expect(group.getByText("Chagua kutwa au bweni.")).toBeVisible()
  }
  await expect(page.getByRole("group", { name: "Mtoto 1" }).getByLabel(t.childName)).toBeFocused()
})

for (const lang of ["sw", "en"] as const) {
  test(`the document language is ${lang} when the page is`, async ({ page, context }) => {
    if (lang === "en") await context.addCookies([{ name: "lang", value: "en", url: `http://localhost:${E2E_PORT}` }])
    await page.goto("/apply")
    await expect(page.locator("html")).toHaveAttribute("lang", lang)
  })
}

test("with the phone's text doubled, the header wraps and nothing scrolls sideways", async ({ page }) => {
  await page.goto("/apply")
  await page.addStyleTag({ content: "html { font-size: 200% !important; }" })
  await expect(heading(page, 0)).toBeVisible()

  const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }))
  expect(widths.scroll).toBeLessThanOrEqual(widths.client)

  const title = await page.getByText("Fomu ya Udahili", { exact: true }).boundingBox()
  const languages = await page.getByRole("group", { name: "Lugha" }).boundingBox()
  expect(title && languages).toBeTruthy()
  const overlaps =
    title!.x < languages!.x + languages!.width &&
    languages!.x < title!.x + title!.width &&
    title!.y < languages!.y + languages!.height &&
    languages!.y < title!.y + title!.height
  expect(overlaps).toBe(false)
})

test("each language option is at least 44px tall on a phone", async ({ page }) => {
  for (const path of ["/apply", "/"]) {
    await page.goto(path)
    for (const name of ["Kiswahili", "English"]) {
      const box = await page.getByRole("button", { name, exact: true }).boundingBox()
      expect(box?.height, `${name} on ${path}`).toBeGreaterThanOrEqual(44)
    }
  }
})
