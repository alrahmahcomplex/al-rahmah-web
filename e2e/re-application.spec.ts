import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { family, fillChild, fillParent, PHONE_WIDTH, waitForSecurityCheck, WORDS } from "./admission-form"

// A child already on file (#76): the parent sees exactly the confirmation a
// new child gets, with the lead's existing Admission Number. Behind it the
// form is recorded as a Re-application, which the integration tests check.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])
const t = WORDS.sw

async function apply(page: Page, who: ReturnType<typeof family>) {
  await fillParent(page, "sw", who)
  await page.getByRole("button", { name: t.continue }).click()
  await fillChild(page, "sw", who, nextYear)
  await page.getByRole("button", { name: t.continue }).click()
  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: t.send }).click()
  await expect(page.getByRole("heading", { name: "Maombi yamepokelewa!" })).toBeVisible()
  return page.getByRole("main").innerText()
}

test("a child already on file gets the same confirmation and Admission Number as a new one", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  const first = await apply(page, who)
  const number = first.match(/ADMSN-\d{5}/)?.[0]
  expect(number).toBeDefined()

  // The same parent sends the same child again, on a new form.
  await page.getByRole("button", { name: "Jaza fomu nyingine" }).click()
  const again = await apply(page, who)

  expect(again).toBe(first)
  await expect(page.getByText(number!, { exact: true })).toBeVisible()
  await expect(page.getByText(who.child)).toBeVisible()
})
