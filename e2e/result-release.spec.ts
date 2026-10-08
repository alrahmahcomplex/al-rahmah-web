import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { buildWhatsAppLink, renderResultMessage } from "@/lib/result-messages"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { releaseResult } from "@/lib/services/result-release"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Releasing an interview result through WhatsApp from the lead screen's
// interview panel. The wa.me tab is checked by its address and never reaches
// WhatsApp.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))
const OFFICE_PHONE = "+255 673 526 644"

// Slice 6's seeded Passed lead with its fee Paid, never released.
const SEEDED_PAID = "1ead0000-0000-4000-8000-000000000601"

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

const digits = (count: number) => String(randomInt(0, 10 ** count)).padStart(count, "0")

// A lead of the test's own, interviewed and Passed, with its fee Not Paid and
// a separate WhatsApp number.
async function interviewedLead() {
  const studentName = `Candidate ${randomUUID().slice(0, 6)}`
  const whatsapp = `07${digits(8)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: "Release Parent", relationship: "Mother", phone: `06${digits(8)}`, whatsapp } },
    student: { fullName: studentName, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const interviewId = registered.data.interviewId
  const recorded = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result: "Passed", score: 81.5 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  return { id: created.data.leadId, interviewId, studentName, whatsapp, admissionNumber: created.data.admissionNumber }
}

async function markPaid(interviewId: string) {
  const marked = await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")
  if (!marked.ok) throw new Error(`fee failed: ${marked.error}`)
}

const release = (page: Page) => page.getByRole("region", { name: "Result release" })
const sentToday = `Sent by WhatsApp on ${formatDate(today)} by ${ADMISSIONS.name}`

test.describe("releasing a result through WhatsApp", () => {
  test("blocked while the fee is Not Paid; once Paid, staff check the message and Send through WhatsApp opens it addressed to the parent", async ({
    page,
    context,
  }) => {
    const lead = await interviewedLead()
    // The wa.me tab never leaves the test.
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>wa.me</title>" }))

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)
    await expect(release(page)).toContainText("Not sent yet.")
    await expect(release(page)).toContainText("The result can't be sent until the interview fee is Paid. The family owes TZS 50,000.")
    await expect(release(page).getByRole("button", { name: "Send through WhatsApp" })).toHaveCount(0)
    await expect(release(page).getByRole("group", { name: "Message preview" })).toHaveCount(0)

    await markPaid(lead.interviewId)
    await page.reload()

    const message = renderResultMessage({
      channel: "whatsapp",
      result: "passed",
      parentName: "Release Parent",
      studentName: lead.studentName,
      score: 81.5,
      admissionNumber: lead.admissionNumber,
      className: "STD 4",
      enrollmentYear: thisYear + 1,
      officePhone: OFFICE_PHONE,
    })
    if (!message.ok) throw new Error("the expected message could not be rendered")
    const link = buildWhatsAppLink(`255${lead.whatsapp.slice(1)}`, message.data.text)
    if (!link.ok) throw new Error("the expected link could not be built")

    await expect(release(page)).toContainText(`By WhatsApp to +255 ${lead.whatsapp.slice(1, 4)} ${lead.whatsapp.slice(4, 7)} ${lead.whatsapp.slice(7)}.`)
    await expect(release(page).getByRole("group", { name: "Message preview" })).toHaveText(message.data.text, { useInnerText: true })

    const leadUrl = page.url()
    const opened = page.waitForEvent("popup")
    await release(page).getByRole("button", { name: "Send through WhatsApp" }).click()
    const tab = await opened
    await tab.waitForURL(/^https:\/\/wa\.me\//)
    expect(tab.url()).toBe(link.data)

    await expect(release(page).getByRole("status")).toHaveText("Recorded as sent. WhatsApp opened in a new tab: press send there.")
    await expect(release(page)).toContainText(sentToday)
    // The message never lands in our own address.
    expect(page.url()).toBe(leadUrl)

    await page.goto(`/staff/leads/${lead.id}/history`)
    await expect(page.getByText("sent the result by WhatsApp: Passed, 81.5%")).toBeVisible()
  })

  test("the Accountant sees whether and when the result was sent, with no send button and no message", async ({ page }) => {
    const lead = await interviewedLead()
    await markPaid(lead.interviewId)
    const released = await releaseResult(await signedIn(ADMISSIONS), lead.interviewId, "whatsapp", { officePhone: OFFICE_PHONE })
    if (!released.ok) throw new Error(`release failed: ${released.error}`)

    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${lead.id}`)
    await expect(release(page)).toContainText(sentToday)
    await expect(page.getByRole("button", { name: "Send through WhatsApp" })).toHaveCount(0)
    await expect(page.getByRole("group", { name: "Message preview" })).toHaveCount(0)

    // A Paid result nobody has sent yet.
    await page.goto(`/staff/leads/${SEEDED_PAID}`)
    await expect(release(page)).toContainText("Not sent yet.")
    await expect(page.getByRole("button", { name: "Send through WhatsApp" })).toHaveCount(0)
    await expect(page.getByRole("group", { name: "Message preview" })).toHaveCount(0)
  })
})
