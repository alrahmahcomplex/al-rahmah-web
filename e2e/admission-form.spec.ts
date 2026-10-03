import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { family, fillChild, fillParent, PHONE_WIDTH, waitForSecurityCheck, WORDS, type Lang } from "./admission-form"
import { E2E_PORT } from "./server"

// The public Admission form on a phone, against local Supabase with
// Turnstile's always-pass test keys.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])

for (const lang of ["sw", "en"] as const satisfies Lang[]) {
  test(`applies for one child end to end in ${lang === "sw" ? "Swahili" : "English"}`, async ({ page, context }) => {
    const t = WORDS[lang]
    const who = family()
    if (lang === "en") await context.addCookies([{ name: "lang", value: "en", url: `http://localhost:${E2E_PORT}` }])
    await page.goto("/apply")
    await expect(page.getByRole("main")).toHaveAttribute("lang", lang)

    await expect(page.getByRole("heading", { level: 1, name: t.steps[0] })).toBeVisible()
    await fillParent(page, lang, who)
    await page.getByRole("button", { name: t.continue }).click()

    await expect(page.getByRole("heading", { level: 1, name: t.steps[1] })).toBeVisible()
    await fillChild(page, lang, who, nextYear)
    await page.getByRole("button", { name: t.continue }).click()

    await expect(page.getByRole("heading", { level: 1, name: t.steps[2] })).toBeVisible()
    await expect(page.getByText(who.parent)).toBeVisible()
    await expect(page.getByText(who.child)).toBeVisible()
    await expect(page.getByText(`STD 3 · ${nextYear} · ${t.boarding}`)).toBeVisible()

    await waitForSecurityCheck(page)
    await page.getByRole("button", { name: t.send }).click()

    await expect(page.getByRole("heading", { name: lang === "sw" ? "Maombi yamepokelewa!" : "Application received!" })).toBeVisible()
    await expect(page.getByText(lang === "sw" ? "Namba ya Udahili" : "Admission Number", { exact: true })).toBeVisible()
    await expect(page.getByText(/^ADMSN-\d{5}$/)).toBeVisible()
    await expect(page.getByText(who.child)).toBeVisible()
    await expect(page.getByRole("link", { name: "+255 673 526 644" })).toHaveAttribute("href", "tel:+255673526644")

    await page.getByRole("button", { name: lang === "sw" ? "Jaza fomu nyingine" : "Fill in another form" }).click()
    await expect(page.getByRole("heading", { level: 1, name: t.steps[0] })).toBeVisible()
    await expect(page.getByLabel(t.parentName)).toHaveValue("")
    await expect(page.getByRole("button", { name: t.mother, exact: true })).toHaveAttribute("aria-pressed", "false")
  })
}

test("switching language mid-form keeps every entry", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await fillParent(page, "sw", who)

  await page.getByRole("button", { name: "English" }).click()
  await expect(page.getByRole("main")).toHaveAttribute("lang", "en")
  await expect(page.getByRole("heading", { level: 1, name: "Parent or guardian" })).toBeVisible()
  await expect(page.getByLabel(WORDS.en.parentName)).toHaveValue(who.parent)
  await expect(page.getByRole("button", { name: "Mother", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(page.getByLabel(WORDS.en.phone, { exact: true })).toHaveValue(who.phone)

  await page.getByRole("button", { name: "Continue" }).click()
  await fillChild(page, "en", who, nextYear)
  await page.getByRole("button", { name: "Continue" }).click()

  await page.getByRole("button", { name: "Kiswahili" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Hakiki maombi yako" })).toBeVisible()
  await expect(page.getByText(who.parent)).toBeVisible()
  await expect(page.getByText(`STD 3 · ${nextYear} · Bweni`)).toBeVisible()

  await page.getByRole("button", { name: "Rudi" }).click()
  await expect(page.getByLabel(WORDS.sw.childName)).toHaveValue(who.child)
})

test("Continue names what is missing, and Other asks for a description", async ({ page }) => {
  const who = family()
  await page.goto("/apply")

  await page.getByRole("button", { name: "Endelea" }).click()
  await expect(page.getByText("Andika jina kamili la mzazi au mlezi.")).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Mzazi au mlezi" })).toBeVisible()

  await page.getByLabel(WORDS.sw.parentName).fill(who.parent)
  await page.getByRole("button", { name: "Mwingine", exact: true }).click()
  await page.getByLabel(WORDS.sw.phone, { exact: true }).fill(who.phone)
  await page.getByRole("button", { name: "Endelea" }).click()
  await expect(page.getByText("Eleza uhusiano wako na mtoto.")).toBeVisible()
  await expect(page.getByLabel(WORDS.sw.otherDescription)).toBeFocused()

  await page.getByLabel(WORDS.sw.otherDescription).fill("Shangazi")
  await page.getByRole("button", { name: "Endelea" }).click()
  await expect(page.getByRole("heading", { level: 1, name: "Watoto" })).toBeVisible()

  await page.getByLabel(WORDS.sw.childName).fill(who.child)
  await page.getByRole("button", { name: "Endelea" }).click()
  await expect(page.getByText("Chagua darasa analoomba.")).toBeVisible()
  await expect(page.getByRole("heading", { level: 1, name: "Watoto" })).toBeVisible()

  await page.getByRole("button", { name: "STD 3", exact: true }).click()
  await page.getByRole("button", { name: nextYear, exact: true }).click()
  await page.getByRole("button", { name: "Endelea" }).click()
  await expect(page.getByText("Chagua kutwa au bweni.")).toBeVisible()
})

test("a phone the school can't read sends the parent back to it", async ({ page }) => {
  const who = { ...family(), phone: "12345" }
  await page.goto("/apply")
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: "Endelea" }).click()
  await fillChild(page, "sw", who, nextYear)
  await page.getByRole("button", { name: "Endelea" }).click()
  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: "Tuma maombi" }).click()

  await expect(page.getByRole("heading", { level: 1, name: "Mzazi au mlezi" })).toBeVisible()
  await expect(page.getByText(/Hatukuweza kusoma namba hii ya simu/)).toBeVisible()
  await expect(page.getByLabel(WORDS.sw.phone, { exact: true })).toHaveValue("12345")
})
