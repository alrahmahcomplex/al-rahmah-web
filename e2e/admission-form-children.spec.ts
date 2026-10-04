import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { family, fillChild, fillParent, PHONE_WIDTH, waitForSecurityCheck } from "./admission-form"

// Several children on one Admission form (#75), on a phone, in Swahili,
// against local Supabase with Turnstile's always-pass test keys.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])

test("adds and removes child cards, keeping the entries of the cards that stay", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: "Endelea" }).click()

  await expect(page.getByRole("button", { name: /^Ondoa mtoto/ })).toHaveCount(0)
  await page.getByLabel("Jina kamili la mtoto").fill(`${who.child} A`)

  await page.getByRole("button", { name: "Ongeza mtoto mwingine" }).click()
  const second = page.getByRole("group", { name: "Mtoto 2" })
  await expect(second.getByLabel("Jina kamili la mtoto")).toBeFocused()
  await second.getByLabel("Jina kamili la mtoto").fill(`${who.child} B`)
  await page.getByRole("button", { name: "Ongeza mtoto mwingine" }).click()
  await page.getByRole("group", { name: "Mtoto 3" }).getByLabel("Jina kamili la mtoto").fill(`${who.child} C`)

  await page.getByRole("button", { name: "Ondoa mtoto 2" }).click()
  await expect(page.getByRole("group", { name: "Mtoto 3" })).toHaveCount(0)
  await expect(page.getByRole("group", { name: "Mtoto 1" }).getByLabel("Jina kamili la mtoto")).toHaveValue(`${who.child} A`)
  await expect(page.getByRole("group", { name: "Mtoto 2" }).getByLabel("Jina kamili la mtoto")).toHaveValue(`${who.child} C`)

  await page.getByRole("button", { name: "Ondoa mtoto 1" }).click()
  await expect(page.getByRole("group", { name: /^Mtoto \d$/ })).toHaveCount(1)
  await expect(page.getByLabel("Jina kamili la mtoto")).toHaveValue(`${who.child} C`)
  await expect(page.getByRole("button", { name: /^Ondoa mtoto/ })).toHaveCount(0)

  for (let count = 2; count <= 8; count++) await page.getByRole("button", { name: "Ongeza mtoto mwingine" }).click()
  await expect(page.getByRole("group", { name: /^Mtoto \d$/ })).toHaveCount(8)
  await expect(page.getByRole("button", { name: "Ongeza mtoto mwingine" })).toHaveCount(0)
  await expect(page.getByText("Unaweza kuomba kwa watoto hadi 8 kwenye fomu moja.")).toBeVisible()
})

test("the same child twice on one form is refused before Continue, naming the child", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: "Endelea" }).click()
  await fillChild(page, "sw", who, nextYear, page.getByRole("group", { name: "Mtoto 1" }))
  await page.getByRole("button", { name: "Ongeza mtoto mwingine" }).click()
  const second = page.getByRole("group", { name: "Mtoto 2" })
  await fillChild(page, "sw", { child: `  ${who.child.toUpperCase()} ` }, nextYear, second)
  await page.getByRole("button", { name: "Endelea" }).click()

  await expect(page.getByRole("heading", { level: 1, name: "Watoto" })).toBeVisible()
  await expect(second.getByText(`${who.child} yupo mara mbili kwenye fomu hii.`, { exact: false })).toBeVisible()
  await expect(second.getByLabel("Jina kamili la mtoto")).toBeFocused()
})

test("two children on one form are sent together, and the confirmation lists each with its number", async ({ page }) => {
  const who = family()
  const brother = `${who.child} Kaka`
  await page.goto("/apply")
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: "Endelea" }).click()
  await fillChild(page, "sw", who, nextYear, page.getByRole("group", { name: "Mtoto 1" }))
  await page.getByRole("button", { name: "Ongeza mtoto mwingine" }).click()
  await fillChild(page, "sw", { child: brother }, nextYear, page.getByRole("group", { name: "Mtoto 2" }))
  await page.getByRole("button", { name: "Endelea" }).click()

  await expect(page.getByRole("heading", { level: 1, name: "Hakiki maombi yako" })).toBeVisible()
  await expect(page.getByText("Mtoto 1", { exact: true })).toBeVisible()
  await expect(page.getByText(who.child, { exact: true })).toBeVisible()
  await expect(page.getByText("Mtoto 2", { exact: true })).toBeVisible()
  await expect(page.getByText(brother, { exact: true })).toBeVisible()

  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: "Tuma maombi" }).click()

  await expect(page.getByRole("heading", { name: "Maombi yamepokelewa!" })).toBeVisible()
  const listed = page.getByRole("listitem")
  await expect(listed).toHaveCount(2)
  await expect(listed.nth(0).getByText(who.child, { exact: true })).toBeVisible()
  await expect(listed.nth(0).getByText(/^ADMSN-\d{5}$/)).toBeVisible()
  await expect(listed.nth(1).getByText(brother, { exact: true })).toBeVisible()
  await expect(listed.nth(1).getByText(/^ADMSN-\d{5}$/)).toBeVisible()
  const numbers = await page.getByText(/^ADMSN-\d{5}$/).allTextContents()
  expect(new Set(numbers).size).toBe(2)
})
