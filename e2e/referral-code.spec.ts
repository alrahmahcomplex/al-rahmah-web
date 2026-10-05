import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"

import { secretClient, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// The Referral code panel on the lead screen (#80): Admissions Staff editing
// and clearing a code, the Manager's approval lowering the fee, and the
// Accountant reading it without edit controls. Tests that change a code make
// their own leads and agents; the seeded ones are only read.

const thisYear = Number(tanzaniaToday().slice(0, 4))

// Slice 4's seeded leads, one per state.
const ASHA_APPROVED = "1ead0000-0000-4000-8000-000000000431"
const JUMA_PENDING = "1ead0000-0000-4000-8000-000000000432"
const TATU_UNRECOGNISED = "1ead0000-0000-4000-8000-000000000433"
// Slice 2's seeded Archived lead.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

async function newLead() {
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Referral Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 6)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function registerPendingAgent() {
  const fullName = `Rehema Referral ${randomUUID().slice(0, 6)}`
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  const phone = `07${String(randomInt(10_000_000, 100_000_000))}`
  const { data, error } = await secretClient().rpc("register_marketing_agent", { full_name: fullName, phone, whatsapp: null })
  if (error) throw new Error(`could not register an agent: ${error.message}`)
  return { fullName, code: data as string }
}

const panel = (page: Page) => page.getByRole("region", { name: "Referral code" })
const fee = (page: Page) => panel(page).getByLabel("Expected interview fee")

test.describe("the Referral code panel", () => {
  test("Admissions Staff add a code, see the agent named as they type, change it, then clear it", async ({ page }) => {
    const lead = await newLead()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead}`)

    await expect(panel(page)).toContainText("No referral code.")
    await expect(fee(page)).toHaveText("TZS 50,000")
    await expect(panel(page).getByRole("button", { name: "Clear" })).toHaveCount(0)

    await panel(page).getByRole("button", { name: "Add a code" }).click()
    const input = panel(page).getByLabel("Referral code")
    const save = panel(page).getByRole("button", { name: "Save" })

    // A code no agent holds can't be saved.
    await input.fill("nope-404")
    await expect(panel(page).getByText("No Marketing Agent has this code.")).toBeVisible()
    await expect(save).toBeDisabled()

    // Matched however it is typed.
    await input.fill(" bjn -402")
    await expect(panel(page).getByText("Baraka Juma Njoroge · Approved")).toBeVisible()
    await save.click()

    await expect(panel(page).getByText("Referral code set to BJN-402.")).toBeVisible()
    await expect(panel(page).getByLabel("Code", { exact: true })).toHaveText("BJN-402")
    await expect(panel(page)).toContainText("Approved")
    await expect(panel(page)).toContainText("Marketing Agent: Baraka Juma Njoroge")
    await expect(fee(page)).toHaveText("TZS 30,000")
    await expect(panel(page)).toContainText("includes TZS 20,000 discount")

    // Changed to a Pending agent's code: the fee goes back up.
    await panel(page).getByRole("button", { name: "Edit" }).click()
    await expect(panel(page).getByText("(the lead's current code)")).toBeVisible()
    await panel(page).getByLabel("Referral code").fill("znm-401")
    await expect(panel(page).getByText(/Zawadi Neema Mwakasege · Pending/)).toBeVisible()
    await panel(page).getByRole("button", { name: "Save" }).click()
    await expect(panel(page).getByLabel("Code", { exact: true })).toHaveText("ZNM-401")
    await expect(panel(page)).toContainText("Pending")
    await expect(fee(page)).toHaveText("TZS 50,000")
    await expect(panel(page)).toContainText("The discount applies once the Manager approves the agent.")

    // Cleared, after confirming.
    await panel(page).getByRole("button", { name: "Clear" }).click()
    const dialog = page.getByRole("alertdialog")
    await expect(dialog).toContainText("ZNM-401")
    await dialog.getByRole("button", { name: "Clear code" }).click()
    await expect(panel(page).getByText("Referral code cleared.")).toBeVisible()
    await expect(panel(page)).toContainText("No referral code.")

    // Every change is in the lead's history, with the old and new code.
    await page.getByRole("link", { name: "History" }).click()
    await expect(page.getByText("added a Referral code")).toBeVisible()
    await expect(page.getByText("changed the Referral code")).toBeVisible()
    await expect(page.getByText("cleared the Referral code")).toBeVisible()
  })

  test("the Manager approves a Pending agent and the lead's fee drops to TZS 30,000", async ({ page }) => {
    const agent = await registerPendingAgent()
    const lead = await newLead()
    const set = await setLeadReferralCode(await signedIn(ADMISSIONS), lead, agent.code)
    if (!set.ok) throw new Error(`could not set the code: ${set.error}`)

    await signIn(page, MANAGER)
    await page.goto(`/staff/leads/${lead}`)
    await expect(panel(page)).toContainText("Pending")
    await expect(fee(page)).toHaveText("TZS 50,000")

    await page.goto(`/staff/agents?q=${encodeURIComponent(agent.code)}`)
    const row = page.getByRole("row", { name: new RegExp(agent.fullName) })
    // The Leads column: one lead carries the code.
    await expect(row.getByRole("cell").nth(5)).toHaveText("1")
    await row.getByRole("button", { name: `Approve ${agent.fullName}` }).click()
    await page.getByRole("alertdialog").getByRole("button", { name: `Approve ${agent.code}` }).click()
    await expect(page.getByText(`${agent.fullName} (${agent.code}) is Approved.`)).toBeVisible()

    await page.goto(`/staff/leads/${lead}`)
    await expect(panel(page)).toContainText("Approved")
    await expect(fee(page)).toHaveText("TZS 30,000")
    await expect(panel(page)).toContainText("includes TZS 20,000 discount")
  })

  test("the Accountant reads each state with no Edit or Clear", async ({ page }) => {
    await signIn(page, ACCOUNTANT)

    await page.goto(`/staff/leads/${ASHA_APPROVED}`)
    await expect(panel(page).getByLabel("Code", { exact: true })).toHaveText("BJN-402")
    await expect(panel(page)).toContainText("Approved")
    await expect(fee(page)).toHaveText("TZS 30,000")
    await expect(panel(page).getByRole("button")).toHaveCount(0)

    await page.goto(`/staff/leads/${JUMA_PENDING}`)
    await expect(panel(page)).toContainText("Marketing Agent: Zawadi Neema Mwakasege")
    await expect(fee(page)).toHaveText("TZS 50,000")
    await expect(panel(page).getByRole("button")).toHaveCount(0)

    await page.goto(`/staff/leads/${TATU_UNRECOGNISED}`)
    await expect(panel(page)).toContainText("Unrecognised")
    await expect(panel(page)).toContainText("No Marketing Agent has this code.")
    await expect(panel(page).getByRole("button")).toHaveCount(0)
  })

  test("a closed lead shows its panel read-only, even to Admissions Staff", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${ARCHIVED}`)
    await expect(panel(page)).toContainText("No referral code.")
    await expect(fee(page)).toHaveText("TZS 50,000")
    await expect(panel(page).getByRole("button")).toHaveCount(0)
  })
})
