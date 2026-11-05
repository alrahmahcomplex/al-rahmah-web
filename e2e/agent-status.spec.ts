import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "@/lib/admission-form"
import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"

import { registerApprovedAgent } from "../tests/support/agents"
import { secretClient, signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { family, fillChild, fillParent, PHONE_WIDTH, type Lang } from "./admission-form"
import { E2E_PORT } from "./server"

// Switching an agent off and retiring them (#187): the Manager's dialog with
// the families it changes, the Retired filter, the lead's fee line, and the
// Admission form's note for a switched-off code. Every agent and lead is the
// test's own; the seeded agents stay as they are.

const thisYear = Number(tanzaniaToday().slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// An Approved agent of the test's own, registered and approved in one
// transaction so the Marketing Agents spec never sees it Pending.
async function approvedAgent() {
  const fullName = `Imani Status ${randomUUID().slice(0, 6)}`
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  const phone = `07${String(randomInt(10_000_000, 100_000_000))}`
  const { id, code } = await registerApprovedAgent(MANAGER, { fullName, phone })
  return { id, fullName, code }
}

// The Manager's action, as the screen calls it, for a test's setup.
async function changeStatus(agentId: string, kind: "switched_off" | "retired") {
  const { error } = await (await signedIn(MANAGER)).rpc("change_marketing_agent_status", { agent_id: agentId, kind, reason: "E2E setup" })
  if (error) throw new Error(`could not change the agent's status: ${error.message}`)
}

async function leadWithCode(code: string) {
  const student = `Pupil ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Status Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: student, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const set = await setLeadReferralCode(await signedIn(ADMISSIONS), created.data.leadId, code)
  if (!set.ok) throw new Error(`could not set the code: ${set.error}`)
  return { leadId: created.data.leadId, student }
}

test.describe("switching an agent off and retiring them", () => {
  test("the Manager sees the families a switch-off changes, gives a reason, and the lead's fee loses the discount", async ({ page }) => {
    const agent = await approvedAgent()
    const lead = await leadWithCode(agent.code)
    await signIn(page, MANAGER)

    await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(agent.code)}`)
    const row = page.getByRole("row", { name: new RegExp(agent.fullName) })
    await row.getByRole("button", { name: `Switch off ${agent.fullName}` }).click()

    const dialog = page.getByRole("dialog")
    await expect(dialog).toContainText(`Switch off ${agent.fullName}?`)
    await expect(dialog.getByText("This changes the interview fee for 1 family not yet Paid.")).toBeVisible()
    const families = dialog.getByRole("list", { name: "Families not yet Paid" })
    await expect(families.getByRole("listitem")).toHaveCount(1)
    await expect(families).toContainText(lead.student)
    await expect(families).toContainText("Status Parent")
    await expect(families).toContainText("TZS 40,000 → TZS 50,000")
    await expect(dialog.getByText("Code ya punguzo mliyotumia haitoi punguzo kwa sasa. Ada ya usaili sasa ni TZS 50,000 kwa kila mtoto.")).toBeVisible()

    // A reason is required: confirm stays disabled while Reason is empty or only spaces.
    const confirm = dialog.getByRole("button", { name: `Switch off ${agent.code}` })
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel("Reason").fill("   ")
    await expect(confirm).toBeDisabled()
    await dialog.getByLabel("Reason").fill("Has left the school")
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(page.getByText(`${agent.fullName} (${agent.code}) is switched off. 1 family's interview fee changed.`)).toBeVisible()
    await expect(row).toContainText("Switched off")
    await expect(row).toContainText(`Switched off by ${MANAGER.name} on`)
    await expect(row.getByRole("button", { name: `Switch on ${agent.fullName}` })).toBeVisible()

    await page.goto(`/staff/leads/${lead.leadId}`)
    const panel = page.getByRole("region", { name: "Referral code" })
    await expect(panel).toContainText("Switched off")
    await expect(panel.getByLabel("Expected interview fee")).toHaveText("TZS 50,000")
    await expect(panel).toContainText("No discount: code switched off on")
  })

  test.describe("on a short phone", () => {
    test.use({ viewport: { width: 360, height: 640 } })

    test("with several families listed, the dialog fits the screen and the reason and confirm button can be reached", async ({ page }) => {
      const agent = await approvedAgent()
      for (let i = 0; i < 6; i++) await leadWithCode(agent.code)
      await signIn(page, MANAGER)

      await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(agent.code)}`)
      const row = page.getByRole("row", { name: new RegExp(agent.fullName) })
      await row.getByRole("button", { name: `Retire ${agent.fullName}` }).click()

      const dialog = page.getByRole("dialog")
      await expect(dialog.getByRole("list", { name: "Families not yet Paid" }).getByRole("listitem")).toHaveCount(6)
      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(640)

      // The buttons stay in view while Tab moves focus down the body to the reason.
      const confirm = dialog.getByRole("button", { name: `Retire ${agent.code}` })
      await expect(confirm).toBeInViewport({ ratio: 1 })
      await expect(confirm).toBeDisabled()
      const reason = dialog.getByLabel("Reason")
      for (let i = 0; i < 10 && !(await reason.evaluate((el) => el === document.activeElement)); i++) {
        await page.keyboard.press("Tab")
      }
      await expect(reason).toBeFocused()
      await page.keyboard.type("Has left the school")
      await expect(reason).toBeInViewport()
      await expect(reason).toHaveValue("Has left the school")
      await expect(confirm).toBeEnabled()
      await expect(confirm).toBeInViewport({ ratio: 1 })
      await confirm.click()

      await expect(page.getByText(`${agent.fullName} (${agent.code}) is retired.`, { exact: false })).toBeVisible()
    })
  })

  test("a retired record is hidden from the list until the Retired filter shows it, with who retired it", async ({ page }) => {
    const agent = await approvedAgent()
    await changeStatus(agent.id, "retired")
    await signIn(page, MANAGER)

    await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(agent.code)}`)
    await expect(page.getByText("No agent matches this search.")).toBeVisible()

    await page.getByRole("navigation", { name: "Agent status" }).getByRole("link", { name: "Retired" }).click()
    await expect(page).toHaveURL(/status=retired/)
    const row = page.getByRole("row", { name: new RegExp(agent.fullName) })
    await expect(row).toContainText("Retired")
    await expect(row).toContainText(`Retired by ${MANAGER.name} on`)
    // A retired record has no actions left.
    await expect(row.getByRole("button")).toHaveCount(0)
  })
})

test.describe("the Admission form", () => {
  test.use({ viewport: PHONE_WIDTH })

  const nextYear = String(admissionYears()[1])
  const FIELD = { sw: "Code ya Punguzo · si lazima", en: "Discount code · optional" } as const

  async function toReview(page: Page, lang: Lang) {
    const who = family()
    await fillParent(page, lang, who)
    await page.getByRole("button", { name: lang === "sw" ? "Endelea" : "Continue" }).click()
    const card = page.getByRole("group", { name: `${lang === "sw" ? "Mtoto" : "Child"} 1` })
    await fillChild(page, lang, { child: `${who.child} 1` }, nextYear, card)
    await page.getByRole("button", { name: lang === "sw" ? "Endelea" : "Continue" }).click()
  }

  test("a switched-off code says it gives no discount for now, in Swahili and English, at the full fee", async ({ page }) => {
    const agent = await approvedAgent()
    await changeStatus(agent.id, "switched_off")

    await page.goto("/apply")
    await toReview(page, "sw")
    const field = page.getByLabel(FIELD.sw)
    await field.fill(agent.code.toLowerCase())
    await field.blur()
    await expect(page.getByText("Code hii haitoi punguzo kwa sasa. Unaweza kutuma fomu.")).toBeVisible()
    await expect(page.getByText("TZS 50,000 kwa kila mtoto")).toBeVisible()

    await page.context().addCookies([{ name: "lang", value: "en", url: `http://localhost:${E2E_PORT}` }])
    await page.goto("/apply")
    await toReview(page, "en")
    await page.getByLabel(FIELD.en).fill(agent.code)
    await page.getByLabel(FIELD.en).blur()
    await expect(page.getByText("This code gives no discount at the moment. You can still send the form.")).toBeVisible()
    await expect(page.getByText("TZS 50,000 per child")).toBeVisible()
  })
})
