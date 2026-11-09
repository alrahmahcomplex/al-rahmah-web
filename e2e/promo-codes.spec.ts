import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"

import { secretClient, signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { leadUrl } from "./lead-page"
import { logIn } from "./log-in"

// The Promo codes page: the Manager creates a code, an application carrying
// it shows the code's own amount with no agent, and pausing it moves the
// unpaid fee. Admissions Staff read the codes with no controls. Each code
// and application is the test's own; a Promo code can never be deleted, so
// the codes carry random letters.

const thisYear = Number(tanzaniaToday().slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await logIn(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

// Letters and digits only, 4 to 12, and never an agent's ABC-123.
function newCode(): string {
  return `PR${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

async function applicationWithCode(code: string) {
  const student = `Pupil ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Promo Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: student, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const set = await setLeadReferralCode(await signedIn(ADMISSIONS), created.data.leadId, code)
  if (!set.ok) throw new Error(`could not set the code: ${set.error}`)
  return { leadId: created.data.leadId, student }
}

// A Promo code made as the Manager, for a test that only reads it.
async function promoCode(name: string, amount: number) {
  const code = newCode()
  const { error } = await (await signedIn(MANAGER)).rpc("create_promo_code", { name, code, amount, ends_on: null, note: "E2E" })
  if (error) throw new Error(`could not create a Promo code: ${error.message}`)
  return code
}

const referral = (page: Page) => page.getByRole("region", { name: "Referral code" })

test.describe("Promo codes", () => {
  test("the Manager creates a Promo code, an application shows its fee with no agent, and pausing it moves the fee", async ({ page }) => {
    const code = newCode()
    const name = `Instagram ad ${randomUUID().slice(0, 6)}`
    await signIn(page, MANAGER)

    await page.getByRole("navigation").getByRole("link", { name: "Promo codes" }).first().click()
    await expect(page).toHaveURL(/\/staff\/promo-codes$/)
    await expect(page.getByRole("heading", { name: "Promo codes", level: 1 })).toBeVisible()
    await page.getByRole("button", { name: "New Promo code" }).click()

    const sheet = page.getByRole("dialog", { name: "New Promo code" })
    await sheet.getByLabel("Name").fill(name)
    await sheet.getByLabel("Code parents type").fill(code.toLowerCase())
    await expect(sheet.getByText(`${code} is available.`)).toBeVisible()
    await sheet.getByLabel("Amount off the TZS 50,000 fee").fill("20000")
    await expect(sheet.getByText("Fee becomes TZS 30,000")).toBeVisible()
    // The note compares the amount with the most an agent's code gives.
    await expect(sheet.getByText(/^(More than any agent gives|Same as the highest agent discount|Less than an agent can give)/)).toBeVisible()
    await sheet.getByRole("button", { name: "Create code" }).click()

    await expect(page.getByText(`${code} created. Parents can use it now.`)).toBeVisible()
    await expect(sheet).toBeHidden()
    const row = page.getByRole("row", { name: new RegExp(code) })
    await expect(row).toContainText(name)
    await expect(row).toContainText("TZS 20,000 · fee TZS 30,000")
    await expect(row).toContainText("Active")

    // The same code can't be made twice.
    await page.getByRole("button", { name: "New Promo code" }).click()
    const again = page.getByRole("dialog", { name: "New Promo code" })
    await again.getByLabel("Code parents type").fill(code)
    await expect(again.getByText(`${code} is already used by another Promo code.`)).toBeVisible()
    await again.getByRole("button", { name: "Cancel" }).click()
    await expect(again).toBeHidden()

    const application = await applicationWithCode(code)
    await page.goto(leadUrl(application.leadId))
    await expect(referral(page).getByLabel("Code", { exact: true })).toHaveText(code)
    await expect(referral(page)).toContainText(`Promo code: ${name}`)
    await expect(referral(page)).toContainText("No Marketing Agent. No commission.")
    await expect(referral(page).getByLabel("Expected interview fee")).toHaveText("TZS 30,000")
    await expect(referral(page)).toContainText("includes TZS 20,000 discount")

    // Pausing asks for a reason and lists the unpaid fee it moves.
    await page.goto("/staff/promo-codes")
    await page.getByRole("button", { name: `Open ${code}` }).click()
    const open = page.getByRole("dialog", { name: code })
    await expect(open).toContainText("1 student")
    await open.getByRole("button", { name: "Pause code" }).click()
    await expect(open.getByText(`Pause ${code}?`)).toBeVisible()
    await expect(open.getByText("Gives nothing off until resumed. Fees already Paid keep their amount.")).toBeVisible()
    await expect(open.getByText("1 unpaid interview fee will change")).toBeVisible()
    const confirm = open.getByRole("button", { name: "Pause code" }).last()
    await confirm.click()
    await expect(open.getByText("A reason is required.")).toBeVisible()
    await open.getByLabel("Reason").fill("Campaign on hold")
    await confirm.click()

    await expect(page.getByText(`${code} paused.`)).toBeVisible()
    await expect(page.getByRole("row", { name: new RegExp(code) })).toContainText("Paused")

    await page.goto(leadUrl(application.leadId))
    await expect(referral(page)).toContainText("Paused")
    await expect(referral(page).getByLabel("Expected interview fee")).toHaveText("TZS 50,000")
    await expect(referral(page)).toContainText("No discount: Promo code paused")
  })

  test("Admissions Staff see Promo codes with no control to change them", async ({ page }) => {
    const name = `Masjid group ${randomUUID().slice(0, 6)}`
    const code = await promoCode(name, 15000)
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/promo-codes")

    await expect(page.getByRole("heading", { name: "Promo codes", level: 1 })).toBeVisible()
    await expect(page.getByRole("button", { name: "New Promo code" })).toHaveCount(0)
    await page.getByRole("button", { name: `Open ${code}` }).click()

    const sheet = page.getByRole("dialog", { name: code })
    await expect(sheet).toContainText(name)
    await expect(sheet).toContainText("TZS 15,000 off, fee TZS 35,000")
    await expect(sheet).toContainText("No end date")
    await expect(sheet).toContainText("Only a role with “Set discount amounts and Promo codes” can change this.")
    await expect(sheet.getByRole("textbox")).toHaveCount(0)
    for (const button of ["Save", "Pause code", "End code"]) {
      await expect(sheet.getByRole("button", { name: button })).toHaveCount(0)
    }
  })
})
