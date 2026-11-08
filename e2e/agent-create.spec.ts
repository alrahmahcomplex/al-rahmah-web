import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead } from "@/lib/services/leads"
import { setLeadReferralCode } from "@/lib/services/referral"

import { registerApprovedAgent } from "../tests/support/agents"
import { secretClient, signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Adding an agent and Recreate (#189): the check before saving, the
// duplicate-phone message, and Recreate from a retired code and from a
// current agent's row. Every agent and lead is the test's own.

const thisYear = Number(tanzaniaToday().slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A leading 7 keeps it clear of the seeded 700 000 numbers.
function mobile() {
  return `07${String(randomInt(10_000_000, 100_000_000))}`
}

function spaced(local: string) {
  return `+255 ${local.slice(1, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}

async function approvedAgent() {
  const fullName = `Imani Create ${randomUUID().slice(0, 6)}`
  const phone = mobile()
  const { id, code } = await registerApprovedAgent(MANAGER, { fullName, phone })
  return { id, fullName, code, phone }
}

async function leadWithCode(code: string) {
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Create Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 6)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const set = await setLeadReferralCode(await signedIn(ADMISSIONS), created.data.leadId, code)
  if (!set.ok) throw new Error(`could not set the code: ${set.error}`)
}

async function retire(agentId: string) {
  const { error } = await (await signedIn(MANAGER)).rpc("change_marketing_agent_status", { agent_id: agentId, kind: "retired", reason: "E2E setup" })
  if (error) throw new Error(`could not retire the agent: ${error.message}`)
}

function freshCode() {
  const letter = () => String.fromCharCode(65 + randomInt(0, 26))
  return `E${letter()}${letter()}-${randomInt(10_000, 100_000)}`
}

test.describe("adding an agent", () => {
  test("the Manager checks the normalised details before saving, and the agent is Approved", async ({ page }) => {
    const fullName = `Neema Asha ${randomUUID().slice(0, 6)}`
    const phone = mobile()
    const code = freshCode()
    const mailbox = `neema-${randomUUID().slice(0, 8)}`
    await signIn(page, MANAGER)
    await page.goto("/staff/agents")
    await page.getByRole("button", { name: "Add agent" }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Full name").fill(`  ${fullName}  `)
    await dialog.getByLabel("Mobile").fill(phone)
    await dialog.getByLabel("Email").fill(`${mailbox.toUpperCase()}@Example.TEST`)
    await dialog.getByLabel("Existing code").fill(code.toLowerCase())
    await dialog.getByRole("button", { name: "Check details" }).click()

    const summary = dialog.getByRole("definition")
    await expect(dialog.getByRole("heading", { name: "Check before saving" })).toBeVisible()
    await expect(summary.filter({ hasText: fullName })).toHaveCount(1)
    await expect(summary.filter({ hasText: spaced(phone) })).toHaveCount(1)
    await expect(summary.filter({ hasText: `${mailbox}@example.test` })).toHaveCount(1)
    await expect(summary.filter({ hasText: code })).toHaveCount(1)

    await dialog.getByRole("button", { name: "Create agent" }).click()
    await expect(page.getByText(`${fullName} (${code}) is added and Approved.`)).toBeVisible()

    await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(code)}`)
    const row = page.getByRole("row", { name: new RegExp(fullName) })
    await expect(row).toContainText("Approved")
    await expect(row).toContainText(MANAGER.name)
  })

  test("a phone already used names its agent, links to the record, and saves nothing", async ({ page }) => {
    const existing = await approvedAgent()
    await signIn(page, MANAGER)
    await page.goto("/staff/agents")
    await page.getByRole("button", { name: "Add agent" }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Full name").fill(`Someone Else ${randomUUID().slice(0, 6)}`)
    await dialog.getByLabel("Mobile").fill(spaced(existing.phone))
    await dialog.getByRole("button", { name: "Check details" }).click()

    await expect(dialog.getByText(`This number already belongs to ${existing.fullName}, ${existing.code}, Approved`)).toBeVisible()
    await dialog.getByRole("link", { name: `Open ${existing.fullName}'s record` }).click()
    await expect(page).toHaveURL(new RegExp(`q=${existing.code}`))
    await expect(page.getByRole("row", { name: new RegExp(existing.fullName) })).toBeVisible()
    await expect(page.getByText("1 agent", { exact: true })).toBeVisible()
  })

  test("a staff member's email is only in use, with no name", async ({ page }) => {
    await signIn(page, MANAGER)
    await page.goto("/staff/agents")
    await page.getByRole("button", { name: "Add agent" }).click()

    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Full name").fill(`Someone Else ${randomUUID().slice(0, 6)}`)
    await dialog.getByLabel("Mobile").fill(mobile())
    await dialog.getByLabel("Email").fill(ADMISSIONS.email)
    await dialog.getByRole("button", { name: "Check details" }).click()

    await expect(dialog.getByText(`${ADMISSIONS.email} is already in use at Al-Rahmah. Use another email.`)).toBeVisible()
    await expect(dialog).not.toContainText(ADMISSIONS.name)
  })
})

test.describe("Recreate", () => {
  test("a retired record's code offers Recreate; the Manager confirms the same person and the students keep the code", async ({ page }) => {
    const old = await approvedAgent()
    await leadWithCode(old.code)
    await leadWithCode(old.code)
    await retire(old.id)
    const newPhone = mobile()

    await signIn(page, MANAGER)
    await page.goto("/staff/agents")
    await page.getByRole("button", { name: "Add agent" }).click()
    const dialog = page.getByRole("dialog")
    await dialog.getByLabel("Full name").fill(old.fullName)
    await dialog.getByLabel("Mobile").fill(newPhone)
    await dialog.getByLabel("Existing code").fill(old.code)
    await dialog.getByRole("button", { name: "Check details" }).click()

    await expect(dialog.getByText(`This code belonged to retired record ${old.fullName}. 2 students carry it.`)).toBeVisible()
    await dialog.getByRole("button", { name: "Recreate" }).click()

    // The fee-impact dialog: the retired code gives no discount now, so both
    // families' fees get it back.
    await expect(dialog.getByText("This changes the interview fee for 2 families not yet Paid.")).toBeVisible()
    await expect(dialog.getByRole("list", { name: "Families not yet Paid" }).getByRole("listitem")).toHaveCount(2)
    await expect(dialog.getByLabel("Mobile")).toHaveValue(newPhone)

    const confirm = dialog.getByRole("button", { name: `Recreate ${old.code}` })
    await dialog.getByLabel("Reason").fill("Same person, new number")
    await expect(confirm).toBeDisabled()
    await dialog.getByRole("checkbox", { name: `This is the same person. The 2 students carrying ${old.code} move to the new record.` }).check()
    await expect(confirm).toBeEnabled()
    await confirm.click()

    await expect(page.getByText(`${old.fullName} (${old.code}) is recreated. 2 students keep the code. 2 families' interview fee changed.`)).toBeVisible()
    await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(old.code)}`)
    const row = page.getByRole("row", { name: new RegExp(old.fullName) })
    await expect(row).toContainText("Approved")
    await expect(row).toContainText(spaced(newPhone))
  })

  test.describe("on a short phone", () => {
    test.use({ viewport: { width: 360, height: 640 } })

    test("Recreate from a current agent's row fits the screen, keeps the focused reason in view and the confirm button reachable", async ({ page }) => {
      const old = await approvedAgent()
      for (let i = 0; i < 3; i++) await leadWithCode(old.code)
      await signIn(page, MANAGER)
      await page.goto(`/staff/agents?status=all&q=${encodeURIComponent(old.code)}`)
      await page.getByRole("row", { name: new RegExp(old.fullName) }).getByRole("button", { name: `Recreate ${old.fullName}` }).click()

      const dialog = page.getByRole("dialog")
      await expect(dialog.getByLabel("Full name")).toHaveValue(old.fullName)
      // Approved before and after: no fee moves.
      await expect(dialog.getByText("This changes the interview fee for 0 families not yet Paid.")).toBeVisible()
      const box = await dialog.boundingBox()
      expect(box).not.toBeNull()
      expect(box!.y).toBeGreaterThanOrEqual(0)
      expect(box!.y + box!.height).toBeLessThanOrEqual(640)

      const confirm = dialog.getByRole("button", { name: `Recreate ${old.code}` })
      await expect(confirm).toBeInViewport({ ratio: 1 })
      await dialog.getByLabel("Full name").fill(`${old.fullName} Corrected`)
      await dialog.getByRole("checkbox", { name: `This is the same person. The 3 students carrying ${old.code} move to the new record.` }).check()
      const reason = dialog.getByLabel("Reason")
      await reason.focus()
      await expect(reason).toBeInViewport({ ratio: 1 })
      await page.keyboard.type("Name spelled wrong")
      await expect(confirm).toBeEnabled()
      await expect(confirm).toBeInViewport({ ratio: 1 })
      await confirm.click()

      await expect(page.getByText(`${old.fullName} Corrected (${old.code}) is recreated. 3 students keep the code. No interview fee changed.`)).toBeVisible()
    })
  })
})
