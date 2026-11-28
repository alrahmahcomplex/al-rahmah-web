import { randomInt, randomUUID } from "node:crypto"

import { type Browser, type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead, type LeadClass } from "@/lib/services/leads"
import { linkSibling } from "@/lib/services/sibling-groups"

import { signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { leadUrl } from "./lead-page"
import { signInOnce } from "./log-in"

// The Sibling screens on the lead record (#310): the group says why each
// fee is what it is; the desk asks for the Sibling
// discount from the record with the proof the family will bring; the
// Admissions Manager sees what a grant changes, then grants it; and a close
// father's name asks "One name, or two?" before anything is saved. Each test
// makes its own families.

const thisYear = Number(tanzaniaToday().slice(0, 4))
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(0, 26))).join("")
// A father's name of three words no other test uses.
const father = () => `JUMA${letters(4)} SALIM${letters(4)} MRISHO${letters(4)}`

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

async function child(first: string, fatherName: string, className: LeadClass) {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: `Sibling Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `${first} ${fatherName}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: tanzaniaToday() },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function linked(leadId: string, siblingOfLeadId: string) {
  const answer = await linkSibling(await signedIn(ADMISSIONS), { leadId, siblingOfLeadId })
  if (!answer.ok || answer.data.kind !== "linked") throw new Error(`link failed: ${JSON.stringify(answer)}`)
}

const group = (page: Page) => page.getByRole("region", { name: "Sibling group" })

async function asManager(browser: Browser) {
  const page = await (await browser.newContext()).newPage()
  await signIn(page, MANAGER)
  return page
}

test.describe("the Sibling group on the record", () => {
  test("the desk sends a Sibling request with the proof, and the Manager grants it after seeing what changes", async ({ page, browser }) => {
    const first = `LATIFA${letters(4)}`
    const second = `BAKARI${letters(4)}`
    const latifa = await child(first, father(), "STD 6")
    const bakari = await child(second, father(), "STD 2")
    await linked(bakari, latifa)

    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(bakari))
    await expect(group(page)).toContainText("Full fee: the fathers’ names don’t match, and no Sibling request has been sent.")

    await group(page).getByRole("button", { name: "Request the Sibling discount" }).click()
    const ask = page.getByRole("dialog", { name: "Request the Sibling discount" })
    await ask.getByRole("button", { name: "Send the request" }).click()
    await expect(ask.getByRole("alert")).toHaveText("Write what proof the family will bring.")
    await ask.getByRole("textbox", { name: "What proof will the family bring?" }).fill("Both birth certificates on Thursday")
    await ask.getByRole("button", { name: "Send the request" }).click()
    await expect(page.getByText("Request sent to the Admissions Manager. Reason: fathers’ names don’t match.")).toBeVisible()
    await expect(group(page)).toContainText("Sibling request waiting.")
    await expect(group(page).getByRole("button", { name: "Request the Sibling discount" })).toHaveCount(0)

    const manager = await asManager(browser)
    await manager.goto("/staff/discounts")
    const row = manager.getByRole("listitem").filter({ hasText: `${second}` }).filter({ hasText: "Sibling · 10%" })
    await row.getByRole("button", { name: "Review" }).click()
    const review = manager.getByRole("dialog", { name: "Sibling · 10%" })
    await expect(review).toContainText("Proof noted at the desk: Both birth certificates on Thursday")
    await expect(review.locator(".sg-pv")).toContainText(`Sibling 10%, because ${first} pays the full fee.`)
    await review.getByRole("button", { name: "Grant discount" }).click()
    await expect(manager.getByText(/^Granted for .+\. The desk can see it now\.$/)).toBeVisible()

    await manager.goto(leadUrl(bakari))
    await expect(group(manager)).toContainText(`Sibling 10%, because ${first} pays the full fee.`)
    await expect(group(manager)).toContainText("Counted as a sibling: the Admissions Manager granted the Sibling request on")
  })

  test("a close father's name asks one name or two, and a typing mistake keeps the siblings counting", async ({ page }) => {
    const name = father()
    const neema = await child(`NEEMA${letters(4)}`, name, "STD 5")
    const salma = await child(`SALMA${letters(4)}`, name, "STD 5")
    await linked(salma, neema)
    const [fatherFirst, fatherMiddle, fatherLast] = name.split(" ")

    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(salma))
    await page.getByRole("button", { name: "Edit father’s full name" }).click()
    const form = page.getByRole("form", { name: "Edit father’s full name" })
    await form.getByPlaceholder("Last name").fill(`${fatherLast}A`)
    await form.getByRole("button", { name: "Save" }).click()

    const question = page.getByRole("dialog", { name: "One name, or two?" })
    await expect(question).toContainText(`${fatherFirst} ${fatherMiddle} ${fatherLast}A`)
    // Closing it saves nothing.
    await question.getByRole("button", { name: "Close" }).click()
    await expect(page.getByText("Nothing saved. The father’s name is as it was.")).toBeVisible()
    await form.getByRole("button", { name: "Save" }).click()
    await question.locator("label").filter({ hasText: `The right name is ${name}.` }).click()
    await expect(page.getByText("Saved as one name. Still siblings.")).toBeVisible()
    await expect(group(page)).toContainText("typing mistake confirmed · this student")
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible()
  })
})
