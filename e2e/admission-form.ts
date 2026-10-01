import { randomInt, randomUUID } from "node:crypto"

import { expect, type Page } from "@playwright/test"

// Helpers the Admission form specs share. Every run invents its own names
// (never "Fixture", which the Leads specs count) and numbers (a leading 7 keeps them clear of the seeded 700 000 numbers), since
// the local database keeps every lead the tests make.

export const PHONE_WIDTH = { width: 390, height: 844 }

export function family() {
  const suffix = randomUUID().slice(0, 6)
  return {
    parent: `Mzazi Majaribio ${suffix}`,
    phone: `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
    child: `Mtoto Majaribio ${suffix}`,
  }
}

export const WORDS = {
  sw: {
    parentName: "Jina kamili la mzazi au mlezi",
    mother: "Mama",
    other: "Mwingine",
    otherDescription: "Eleza uhusiano wako na mtoto",
    phone: "Namba ya simu",
    continue: "Endelea",
    back: "Rudi",
    childName: "Jina kamili la mtoto",
    day: "Kutwa",
    boarding: "Bweni",
    send: "Tuma maombi",
    steps: ["Mzazi au mlezi", "Watoto", "Hakiki maombi yako"],
  },
  en: {
    parentName: "Parent or guardian's full name",
    mother: "Mother",
    other: "Other",
    otherDescription: "Describe your relationship to the child",
    phone: "Phone number",
    continue: "Continue",
    back: "Back",
    childName: "Child's full name",
    day: "Day",
    boarding: "Boarding",
    send: "Send application",
    steps: ["Parent or guardian", "Children", "Check your application"],
  },
} as const

export type Lang = keyof typeof WORDS

export async function fillParent(page: Page, lang: Lang, who: ReturnType<typeof family>) {
  const t = WORDS[lang]
  await page.getByLabel(t.parentName).fill(who.parent)
  await page.getByRole("button", { name: t.mother, exact: true }).click()
  await page.getByLabel(t.phone, { exact: true }).fill(who.phone)
}

export async function fillChild(page: Page, lang: Lang, who: ReturnType<typeof family>, year: string) {
  const t = WORDS[lang]
  await page.getByLabel(t.childName).fill(who.child)
  await page.getByRole("button", { name: "STD 3", exact: true }).click()
  await page.getByRole("button", { name: year, exact: true }).click()
  await page.getByRole("button", { name: t.boarding, exact: true }).click()
}

// Turnstile's test site key passes on its own; wait for its token.
export async function waitForSecurityCheck(page: Page) {
  await expect(page.locator('input[name="cf-turnstile-response"]')).toHaveValue(/.+/, { timeout: 20_000 })
}
