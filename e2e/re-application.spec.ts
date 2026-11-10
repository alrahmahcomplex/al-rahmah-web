import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { family, fillForm, PHONE_WIDTH, send, setLanguageCookie, WORDS } from "./admission-form"

// A student already on file (#76): the parent sees exactly the confirmation a
// new student gets, with the lead's existing Admission Number. Behind it the
// form is recorded as a Re-application, which the integration tests check.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])
const t = WORDS.sw

async function apply(page: Page, who: ReturnType<typeof family>) {
  await fillForm(page, "sw", who, nextYear)
  await send(page, "sw")
  await expect(page.getByRole("heading", { name: t.done })).toBeVisible()
  return page.getByRole("list").innerText()
}

test("a student already on file gets the same confirmation and Admission Number as a new one", async ({ page, context }) => {
  const who = family()
  await setLanguageCookie(context, "sw")
  await page.goto("/apply")
  const first = await apply(page, who)
  const number = first.match(/ADMSN-\d{5}/)?.[0]
  expect(number).toBeDefined()

  // The same parent sends the same student again, on a new form.
  await page.getByRole("button", { name: t.again }).click()
  const again = await apply(page, who)

  expect(again).toBe(first)
  await expect(page.getByText(number!, { exact: true })).toBeVisible()
  await expect(page.getByText(who.child, { exact: true })).toBeVisible()
})
