import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"

import { registerApprovedAgent } from "../tests/support/agents"
import { secretClient, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { leadUrl } from "./lead-page"
import { signInOnce } from "./log-in"

// An agent's own interview discount on Marketing Agents: the Manager sets
// it in the agent's sheet, sees the unpaid fee it moves and gives a reason;
// a fee already Paid keeps its amount. Admissions Staff read the sheet with
// no controls. The standard discount is shared by every test, so it is only
// read here; each agent and application is the test's own.

const thisYear = Number(tanzaniaToday().slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

async function approvedAgent() {
  const fullName = `Imani Discount ${randomUUID().slice(0, 6)}`
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  const phone = `07${String(randomInt(10_000_000, 100_000_000))}`
  const { id, code } = await registerApprovedAgent(MANAGER, { fullName, phone })
  return { id, fullName, code }
}

// An application carrying the code, registered for interview; Paid when asked.
async function applicationWithCode(code: string, paid: boolean) {
  const student = `Pupil ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Discount Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: student, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const leadId = created.data.leadId
  const set = await setLeadReferralCode(await signedIn(ADMISSIONS), leadId, code)
  if (!set.ok) throw new Error(`could not set the code: ${set.error}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  if (paid) {
    const marked = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), registered.data.interviewId, "paid")
    if (!marked.ok) throw new Error(`could not mark the fee Paid: ${marked.error}`)
  }
  return { leadId, student }
}

async function standardAmount(): Promise<number> {
  const { data, error } = await (await signedIn(MANAGER)).rpc("standard_interview_discount")
  if (error || typeof data !== "number") throw new Error(`could not read the standard discount: ${error?.message}`)
  return data
}

const tzs = (amount: number) => `TZS ${amount.toLocaleString("en-US")}`
const referral = (page: Page) => page.getByRole("region", { name: "Referral code" })

test.describe("an agent's own interview discount", () => {
  test("the Manager gives an agent an own amount: the unpaid fee moves, the Paid one keeps its amount", async ({ page }) => {
    const standard = await standardAmount()
    const agent = await approvedAgent()
    const paid = await applicationWithCode(agent.code, true)
    const unpaid = await applicationWithCode(agent.code, false)
    // Whatever the standard is now, an amount of the agent's own.
    const own = standard >= 45_000 ? standard - 5000 : standard + 5000

    await signIn(page, MANAGER)
    await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(agent.code)}`)
    await expect(page.getByText(/^Standard discount/)).toBeVisible()
    const row = page.getByRole("row", { name: new RegExp(agent.fullName) })
    const cell = row.getByRole("button", { name: `Interview discount for ${agent.fullName}: ${tzs(standard)}, standard` })
    await expect(cell).toHaveText(`${tzs(standard)} standard`)
    await cell.click()

    const sheet = page.getByRole("dialog", { name: agent.fullName })
    await expect(sheet).toContainText(agent.code)
    await expect(sheet).toContainText("2 students")
    const save = sheet.getByRole("button", { name: "Save" })
    // Nothing changed yet.
    await expect(save).toBeDisabled()

    await sheet.getByRole("radio", { name: /Own amount/ }).check()
    await sheet.getByLabel("Amount off the TZS 50,000 fee").fill(String(own))
    await expect(sheet.getByText(`Fee becomes ${tzs(50_000 - own)}`)).toBeVisible()
    // Only the fee not yet Paid moves.
    await expect(sheet.getByText("1 unpaid interview fee will change")).toBeVisible()
    await sheet.getByText("1 unpaid interview fee will change").click()
    const families = sheet.getByRole("list", { name: "Families not yet Paid" })
    await expect(families.getByRole("listitem")).toHaveCount(1)
    await expect(families).toContainText(unpaid.student)
    await expect(families).toContainText(`${tzs(50_000 - standard)} → ${tzs(50_000 - own)}`)

    // A reason is required.
    await save.click()
    await expect(sheet.getByText("A reason is required, like every agent change.")).toBeVisible()
    await sheet.getByLabel("Reason").fill("Head teacher, agreed with the Director")
    await save.click()

    await expect(page.getByText(`${agent.code} now gives ${tzs(own)} off. 1 unpaid fee updated.`)).toBeVisible()
    await expect(sheet).toBeHidden()
    await expect(row.getByRole("button", { name: `Interview discount for ${agent.fullName}: ${tzs(own)}, own amount` })).toBeVisible()

    await page.goto(leadUrl(unpaid.leadId))
    await expect(referral(page).getByLabel("Expected interview fee")).toHaveText(tzs(50_000 - own))
    await expect(referral(page)).toContainText(`includes ${tzs(own)} discount`)

    await page.goto(leadUrl(paid.leadId))
    await expect(referral(page).getByLabel("Interview fee paid")).toHaveText(tzs(50_000 - standard))
  })

  test("Admissions Staff read an agent's discount with no control to change it", async ({ page }) => {
    const standard = await standardAmount()
    const agent = await approvedAgent()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(agent.code)}`)

    await expect(page.getByText(/^Standard discount/)).toBeVisible()
    await expect(page.getByRole("button", { name: "Change the standard discount" })).toHaveCount(0)

    const row = page.getByRole("row", { name: new RegExp(agent.fullName) })
    await row.getByRole("button", { name: new RegExp(`^Interview discount for ${agent.fullName}`) }).click()
    const sheet = page.getByRole("dialog", { name: agent.fullName })
    await expect(sheet).toContainText(`${tzs(standard)} off (standard)`)
    await expect(sheet.getByText(tzs(50_000 - standard), { exact: true })).toBeVisible()
    await expect(sheet).toContainText("Only a role with “Set discount amounts and Promo codes” can change this.")
    await expect(sheet.getByRole("radio")).toHaveCount(0)
    await expect(sheet.getByRole("button", { name: "Save" })).toHaveCount(0)
    await sheet.getByRole("button", { name: "Close" }).first().click()
    await expect(sheet).toBeHidden()
  })
})
