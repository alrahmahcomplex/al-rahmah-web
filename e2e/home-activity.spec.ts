import { randomInt, randomUUID } from "node:crypto"

import { type Locator, type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { requestDiscount } from "@/lib/services/discounts"
import { createLead } from "@/lib/services/leads"

import { secretClient, signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// Home's Activity log (#406, prototype v39): a row's side sheet and its next
// step, and who sees which row. The log is the whole school's, so each test
// makes its own rows and pages through the log to find them.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))
const word = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "e").toUpperCase()

async function signIn(page: Page, person: FixtureStaff) {
  await page.context().clearCookies()
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

const activityLog = (page: Page) => page.getByRole("region", { name: "Activity log" })

// The row whose task button names `name`, on whichever page it is.
async function findRow(page: Page, name: RegExp): Promise<Locator | null> {
  const log = activityLog(page)
  // The card shows its skeleton until the first page has loaded.
  await expect(log.getByRole("list")).toBeVisible({ timeout: 15_000 })
  for (let turn = 0; turn < 40; turn++) {
    const row = log.getByRole("button", { name })
    if ((await row.count()) > 0) return row.first()
    const next = log.getByRole("button", { name: "Next page" })
    if ((await next.count()) === 0 || (await next.isDisabled())) return null
    const current = await log.locator('[aria-current="page"]').textContent()
    await next.click()
    await expect(log.locator('[aria-current="page"]')).not.toHaveText(current ?? "")
  }
  return null
}

// A walk-in applicant with a pending Staff child request, raised by an Officer.
async function staffChildRequest() {
  const admissions = await signedIn(ADMISSIONS)
  const name = `ACTIVITY ${word()} ${word()}`
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: `Parent ${word()}`, relationship: "Mother", phone: `03${String(randomInt(0, 100_000_000)).padStart(8, "0")}` } },
    student: { fullName: name, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const requested = await requestDiscount(admissions, created.data.leadId, "staff_child", "Staff ID seen at the desk.", randomUUID())
  if (!requested.ok) throw new Error(`request failed: ${JSON.stringify(requested.error)}`)
  return name
}

// An agent with no email whose code someone claimed on the Discount code page.
async function claimedCode() {
  const fullName = `ZAWADI ${word()} ${word()}`
  const phone = `07${String(randomInt(10_000_000, 100_000_000))}`
  const created = await (await signedIn(MANAGER)).rpc("create_marketing_agent", { full_name: fullName, phone, whatsapp: "", email: "", code: "" })
  const agent = (created.data as { outcome: string; agent: { code: string } } | null)?.agent
  if (created.error || !agent) throw new Error(`could not create: ${JSON.stringify(created.error ?? created.data)}`)
  const claimed = await secretClient().rpc("sign_up_marketing_agent", {
    full_name: `${fullName} MWENYEWE`,
    phone,
    whatsapp: null,
    email: `activity-${randomUUID().slice(0, 8)}@example.test`,
    has_code: true,
    code: agent.code,
  })
  if (claimed.error) throw new Error(`claim failed: ${claimed.error.message}`)
  return fullName
}

test("the Manager opens a request's side sheet and goes on to decide it", async ({ page }) => {
  const name = await staffChildRequest()
  await signIn(page, MANAGER)
  const row = await findRow(page, new RegExp(`^Staff child discount request, ${name}`))
  expect(row, "the request's row").not.toBeNull()

  await row!.click()
  const sheet = page.getByRole("dialog", { name: "Staff child discount request" })
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText(name, { exact: true })).toBeVisible()
  await expect(sheet.getByText("Staff child 25%: Staff ID seen at the desk.")).toBeVisible()
  await expect(sheet.getByText("You can approve or refuse this request.")).toBeVisible()
  await expect(sheet.getByText(ADMISSIONS.name)).toBeVisible()

  await sheet.getByRole("link", { name: "Approve or refuse" }).click()
  await expect(page).toHaveURL(/\/staff\/discounts$/)
})

test("an Officer sees the request without the Manager's button, and never a claimed code", async ({ page }) => {
  const name = await staffChildRequest()
  const agent = await claimedCode()

  await signIn(page, MANAGER)
  expect(await findRow(page, new RegExp(`^Discount code claimed, ${agent}`)), "the Manager sees the claim").not.toBeNull()

  await signIn(page, ADMISSIONS)
  const row = await findRow(page, new RegExp(`^Staff child discount request, ${name}`))
  expect(row, "the request's row").not.toBeNull()
  await expect(row!.locator("xpath=ancestor::li[1]").getByRole("link")).toHaveCount(0)
  await row!.click()
  const sheet = page.getByRole("dialog", { name: "Staff child discount request" })
  await expect(sheet.getByText("Only the Admissions Manager can approve this.")).toBeVisible()
  await expect(sheet.getByRole("link", { name: "Approve or refuse" })).toHaveCount(0)
  await sheet.getByRole("button", { name: "Close" }).last().click()
  await expect(sheet).toBeHidden()

  await page.goto("/staff")
  expect(await findRow(page, new RegExp(`^Discount code claimed, ${agent}`)), "the Officer's log").toBeNull()
})
