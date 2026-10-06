import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { getOverdueCount } from "@/lib/services/follow-ups"
import { createLead } from "@/lib/services/leads"

import { asSystem, secretClient, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// The Follow-ups queue (#92): its sections in order with the nav badge,
// recording a contact from a row, and the Accountant reading it. The tests
// plant follow-ups older than any other, so their rows head Overdue whatever
// else the database holds, and archive their leads afterwards.

test.describe.configure({ mode: "serial" })

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

const made: string[] = []

test.afterAll(async () => {
  if (made.length === 0) return
  await asSystem((sql) =>
    sql.query(
      "update public.leads set closure = 'Archived', closure_reason = 'Duplicate record' where id = any($1) and closure is null",
      [made],
    ),
  )
})

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// A lead with an open follow-up on `dueOn`, planted as the database owner
// because the screen only plans dates from today on.
async function leadDueOn(dueOn: string, note: string | null = null) {
  const phone = `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const studentName = `Queue ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: { contact: { fullName: "Mwanaisha Queue", relationship: "Mother", phone } },
    student: { fullName: studentName, className: "STD 6", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  made.push(created.data.leadId)
  await asSystem((sql) =>
    sql.query("insert into public.follow_ups (lead_id, due_on, note) values ($1, $2, $3)", [created.data.leadId, dueOn, note]),
  )
  return { id: created.data.leadId, studentName, phone: `+255${phone.slice(1)}` }
}

const overdueList = (page: Page) => page.getByRole("list", { name: "Overdue follow-ups" })
const todayList = (page: Page) => page.getByRole("list", { name: "Today" })
const laterList = (page: Page) => page.getByRole("list", { name: "Later" })

test("the queue shows Overdue, then Today, then later follow-ups, with the overdue count on the nav", async ({ page }) => {
  const late = await leadDueOn(addDays(today, -2000), "Ask about the school bus.")
  const dueToday = await leadDueOn(today)
  const expected = await getOverdueCount(await signedIn(ADMISSIONS))
  if (!expected.ok) throw new Error("count failed")

  await signIn(page, ADMISSIONS)
  await page.goto("/staff/follow-ups")

  const nav = page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /^Follow-ups/ })
  await expect(nav).toHaveAccessibleName(new RegExp(`^Follow-ups ?, ${expected.data} overdue$`))

  await expect(page.getByRole("heading", { level: 2 })).toHaveText([/^Overdue/, /^Upcoming/])
  await expect(page.locator("h2, h3")).toHaveText([/^Overdue/, /^Upcoming/, "Today", "Later"])

  const first = overdueList(page).getByRole("listitem").first()
  await expect(first).toContainText(late.studentName)
  await expect(first).toContainText(`STD 6 · ${thisYear + 1}`)
  await expect(first).toContainText(formatDate(addDays(today, -2000)))
  await expect(first).toContainText("Overdue by 2000 days")
  await expect(first).toContainText("Ask about the school bus.")
  await expect(first).toContainText("No contact recorded yet")
  await expect(first).toContainText("Mwanaisha Queue")
  await expect(first.getByRole("link", { name: /^\+255/ })).toHaveAttribute("href", `tel:${late.phone}`)

  await expect(todayList(page)).toContainText(dueToday.studentName)
  await expect(overdueList(page)).not.toContainText(dueToday.studentName)
  await expect(laterList(page).getByRole("listitem").first()).toContainText(/Due (tomorrow|in \d+ days)/)
})

test("recording a contact from a queue row moves the row to Upcoming", async ({ page }) => {
  const lead = await leadDueOn(addDays(today, -1500))
  await signIn(page, ADMISSIONS)
  await page.goto("/staff/follow-ups")

  await overdueList(page).getByRole("link", { name: lead.studentName }).click()
  await expect(page).toHaveURL(new RegExp(`/staff/leads/${lead.id}#lead-follow-ups$`))

  const panel = page.getByRole("region", { name: "Follow-ups" })
  await panel.getByRole("button", { name: "Record follow-up" }).click()
  const record = page.getByRole("dialog", { name: "Record follow-up" })
  await record.getByLabel("Comment").fill("The mother asked us to call after the holiday.")
  await record.getByLabel("Contact method").selectOption("SMS")
  await record.getByLabel("Next follow-up date").fill(addDays(today, 2))
  await record.getByRole("button", { name: "Record follow-up" }).click()
  await expect(panel.getByRole("status")).toHaveText(`Follow-up recorded. Next follow-up on ${formatDate(addDays(today, 2))}.`)

  await page.goto("/staff/follow-ups")
  await expect(overdueList(page)).not.toContainText(lead.studentName)

  // Upcoming may run to several pages; the row is on one of them.
  for (let upcoming = 1; ; upcoming++) {
    await page.goto(`/staff/follow-ups?upcoming=${upcoming}`)
    const row = laterList(page).getByRole("listitem").filter({ hasText: lead.studentName })
    if ((await row.count()) > 0) {
      await expect(row).toContainText(formatDate(addDays(today, 2)))
      await expect(row).toContainText("Due in 2 days")
      await expect(row).toContainText(`Last contact: SMS on ${formatDate(today)}`)
      break
    }
    await expect(page.getByRole("navigation", { name: "Upcoming pages" }).getByRole("link", { name: "Next" })).toBeVisible()
  }
})

test("the Accountant sees the queue, with no actions", async ({ page }) => {
  const lead = await leadDueOn(addDays(today, -1800))
  await signIn(page, ACCOUNTANT)
  await page.getByRole("navigation", { name: "Staff" }).getByRole("link", { name: /^Follow-ups/ }).click()
  await expect(page).toHaveURL(/\/staff\/follow-ups$/)

  await expect(overdueList(page)).toContainText(lead.studentName)
  await expect(page.getByRole("main").getByRole("button")).toHaveCount(0)

  await overdueList(page).getByRole("link", { name: lead.studentName }).click()
  const panel = page.getByRole("region", { name: "Follow-ups" })
  await expect(panel.getByLabel("Follow-up date")).toHaveText(formatDate(addDays(today, -1800)))
  await expect(panel.getByRole("button")).toHaveCount(0)
})
