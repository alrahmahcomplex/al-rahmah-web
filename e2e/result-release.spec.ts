import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { renderResultMessage } from "@/lib/result-messages"
import { buildWhatsAppLink } from "@/lib/whatsapp"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"
import { getLatestResultRelease, releaseResult } from "@/lib/services/result-release"

import { signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { openLeadHistoryAsSuperAdmin } from "./super-admin"
import { leadUrl } from "./lead-page"

// Releasing an interview result through WhatsApp or by SMS from the lead
// screen's interview panel. The wa.me tab is checked by its address and never reaches
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

// A lead of the test's own, interviewed and Passed with 81.5% unless asked
// otherwise, with its fee Not Paid and a separate WhatsApp number unless
// given only a phone.
async function interviewedLead({
  phone = `06${digits(8)}`,
  whatsapp = `07${digits(8)}`,
  result = "Passed",
  score = 81.5,
  parentName = "Release Parent",
}: { phone?: string; whatsapp?: string | null; result?: "Passed" | "Failed"; score?: number; parentName?: string } = {}) {
  const studentName = `Candidate ${randomUUID().slice(0, 6)}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: parentName, relationship: "Mother", phone, whatsapp: whatsapp ?? undefined },
    },
    student: { fullName: studentName, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const interviewId = registered.data.interviewId
  const recorded = await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result, score })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  return { id: created.data.leadId, interviewId, studentName, phone, whatsapp: whatsapp ?? "", admissionNumber: created.data.admissionNumber }
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
    await page.goto(leadUrl(lead.id, "Interview"))
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
    const link = buildWhatsAppLink(message.data.text, `255${lead.whatsapp.slice(1)}`)
    if (!link.ok) throw new Error("the expected link could not be built")

    await expect(release(page)).toContainText(`By WhatsApp to +255 ${lead.whatsapp.slice(1, 4)} ${lead.whatsapp.slice(4, 7)} ${lead.whatsapp.slice(7)}.`)
    await expect(release(page).getByRole("group", { name: "Message preview" })).toHaveText(message.data.text, { useInnerText: true })

    const leadPage = page.url()
    const opened = page.waitForEvent("popup")
    await release(page).getByRole("button", { name: "Send through WhatsApp" }).click()
    const tab = await opened
    await tab.waitForURL(/^https:\/\/wa\.me\//)
    expect(tab.url()).toBe(link.data)

    await expect(release(page).getByRole("status")).toHaveText("Recorded as sent. WhatsApp opened in a new tab: press send there.")
    await expect(release(page)).toContainText(sentToday)
    // The message never lands in our own address.
    expect(page.url()).toBe(leadPage)

    await openLeadHistoryAsSuperAdmin(page, lead.id)
    await expect(page.getByText("sent the result by WhatsApp: Passed, 81.5%")).toBeVisible()
  })

  test("the Accountant sees whether and when the result was sent, with no send button and no message", async ({ page }) => {
    const lead = await interviewedLead()
    await markPaid(lead.interviewId)
    const released = await releaseResult(await signedIn(ADMISSIONS), lead.interviewId, "whatsapp", { officePhone: OFFICE_PHONE })
    if (!released.ok) throw new Error(`release failed: ${released.error}`)

    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(lead.id, "Interview"))
    await expect(release(page)).toContainText(sentToday)
    await expect(page.getByRole("button", { name: "Send through WhatsApp" })).toHaveCount(0)
    await expect(page.getByRole("group", { name: "Message preview" })).toHaveCount(0)

    // A Paid result nobody has sent yet.
    await page.goto(leadUrl(SEEDED_PAID, "Interview"))
    await expect(release(page)).toContainText("Not sent yet.")
    await expect(page.getByRole("button", { name: "Send through WhatsApp" })).toHaveCount(0)
    await expect(page.getByRole("group", { name: "Message preview" })).toHaveCount(0)
  })

  test("the Accountant's Next step says a corrected result is waiting, and only opens the Interview tab", async ({ page }) => {
    const lead = await interviewedLead({ score: 81.5 })
    await markPaid(lead.interviewId)
    const released = await releaseResult(await signedIn(ADMISSIONS), lead.interviewId, "whatsapp", { officePhone: OFFICE_PHONE })
    if (!released.ok) throw new Error(`release failed: ${released.error}`)
    const corrected = await recordInterviewResult(await signedIn(ADMISSIONS), lead.interviewId, {
      interviewDate: today,
      result: "Passed",
      score: 90,
    })
    if (!corrected.ok) throw new Error(`correction failed: ${corrected.error}`)

    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(lead.id))
    const nextStep = page.getByRole("region", { name: "Next step" })
    await expect(nextStep).toContainText("Next step: Send the corrected result")
    await expect(nextStep.getByRole("link", { name: "Send result" })).toHaveCount(0)
    await expect(nextStep.getByRole("link", { name: "Open Interview" })).toBeVisible()
  })
})

test.describe("releasing a result by SMS", () => {
  test("with only a landline-shaped number, Send SMS alone records the release, then shows the text and the number to copy", async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    const lead = await interviewedLead({ phone: `022${digits(7)}`, whatsapp: null, result: "Failed", score: 45 })
    await markPaid(lead.interviewId)
    const phone = `+255${lead.phone.slice(1)}`
    const spaced = `+255 ${lead.phone.slice(1, 4)} ${lead.phone.slice(4, 7)} ${lead.phone.slice(7)}`
    const sms = renderResultMessage({
      channel: "sms",
      result: "failed",
      parentName: "Release Parent",
      studentName: lead.studentName,
      score: 45,
      admissionNumber: lead.admissionNumber,
      className: "STD 4",
      enrollmentYear: thisYear + 1,
      officePhone: OFFICE_PHONE,
    })
    if (!sms.ok) throw new Error("the expected SMS could not be rendered")

    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(lead.id, "Interview"))
    await expect(release(page)).toContainText("None of the parent's numbers can take a WhatsApp link, so the result goes by SMS.")
    await expect(release(page).getByRole("button", { name: "Send through WhatsApp" })).toHaveCount(0)
    await expect(release(page).getByRole("button", { name: "Send SMS instead" })).toHaveCount(0)
    // Nothing to copy until the release is recorded.
    await expect(release(page).getByRole("group", { name: "SMS text" })).toHaveCount(0)
    await expect(release(page)).not.toContainText(spaced)

    await release(page).getByRole("button", { name: "Send SMS", exact: true }).click()
    await expect(release(page).getByRole("status")).toHaveText("Recorded as sent. Send this text from the office phone.", {
      timeout: 15_000,
    })
    await expect(release(page).getByRole("group", { name: "SMS text" })).toHaveText(sms.data.text, { useInnerText: true })
    await expect(release(page)).toContainText(`To ${spaced}`)
    await expect(release(page)).toContainText(`Sent by SMS on ${formatDate(today)} by ${ADMISSIONS.name}`)

    // Windows hands clipboard text back with CRLF line ends.
    const clipboard = async () => (await page.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n")
    await release(page).getByRole("button", { name: "Copy number" }).click()
    await expect.poll(clipboard).toBe(phone)
    await release(page).getByRole("button", { name: "Copy text" }).click()
    await expect.poll(clipboard).toBe(sms.data.text)

    await openLeadHistoryAsSuperAdmin(page, lead.id)
    await expect(page.getByText("sent the result by SMS: Failed, 45%")).toBeVisible()
  })

  test("where WhatsApp is offered, Send SMS instead sends the SMS text to the direct phone", async ({ page }) => {
    const lead = await interviewedLead()
    await markPaid(lead.interviewId)

    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(lead.id, "Interview"))
    await expect(release(page).getByRole("button", { name: "Send through WhatsApp" })).toBeVisible()
    await expect(release(page).getByRole("group", { name: "Message preview" })).toBeVisible()
    await expect(release(page)).toContainText("By WhatsApp to")
    await release(page).getByRole("button", { name: "Send SMS instead" }).click()

    await expect(release(page).getByRole("status")).toHaveText("Recorded as sent. Send this text from the office phone.", {
      timeout: 15_000,
    })
    // The WhatsApp preview and number give way, so staff copy only the SMS.
    await expect(release(page)).toContainText("Sent by SMS instead of WhatsApp.")
    await expect(release(page).getByRole("group", { name: "Message preview" })).toHaveCount(0)
    await expect(release(page)).not.toContainText("By WhatsApp to")
    const whatsappNumber = lead.whatsapp.slice(1)
    await expect(release(page)).not.toContainText(
      `+255 ${whatsappNumber.slice(0, 3)} ${whatsappNumber.slice(3, 6)} ${whatsappNumber.slice(6)}`,
    )
    const direct = lead.phone.slice(1)
    await expect(release(page)).toContainText(`To +255 ${direct.slice(0, 3)} ${direct.slice(3, 6)} ${direct.slice(6)}`)
    await expect(release(page).getByRole("group", { name: "SMS text" })).toContainText(lead.studentName)
    await expect(release(page)).toContainText(`Sent by SMS on ${formatDate(today)} by ${ADMISSIONS.name}`)
  })

  test("names too long for WhatsApp offer Send SMS alone, warning before the send that the text runs long", async ({ page }) => {
    const lead = await interviewedLead({ parentName: `Parent ${"P".repeat(600)}` })
    await markPaid(lead.interviewId)
    const direct = lead.phone.slice(1)
    const spaced = `+255 ${direct.slice(0, 3)} ${direct.slice(3, 6)} ${direct.slice(6)}`
    const note = /^The SMS text takes \d+ messages, more than the usual two\.$/

    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(lead.id, "Interview"))
    await expect(release(page)).toContainText("The names on this lead make the message too long for WhatsApp, so it goes by SMS.")
    await expect(release(page).getByRole("button", { name: "Send through WhatsApp" })).toHaveCount(0)
    await expect(release(page).getByRole("group", { name: "Message preview" })).toHaveCount(0)
    // The note shows before the send; the text and the number do not.
    await expect(release(page).getByText(note)).toBeVisible()
    await expect(release(page).getByRole("group", { name: "SMS text" })).toHaveCount(0)
    await expect(release(page)).not.toContainText(spaced)
    await expect(release(page)).not.toContainText(lead.studentName)

    await release(page).getByRole("button", { name: "Send SMS", exact: true }).click()
    await expect(release(page).getByRole("status")).toHaveText("Recorded as sent. Send this text from the office phone.", {
      timeout: 15_000,
    })
    await expect(release(page).getByRole("group", { name: "SMS text" })).toContainText(lead.studentName)
    await expect(release(page)).toContainText(`To ${spaced}`)
    await expect(release(page).getByText(note)).toHaveCount(1)
  })
})

test.describe("sending a result again", () => {
  test("a repeat send asks first; Don't send records nothing and opens no tab, and the warning after a correction never blocks", async ({
    page,
    context,
  }) => {
    const lead = await interviewedLead({ score: 81.5 })
    await markPaid(lead.interviewId)
    const first = await releaseResult(await signedIn(ADMISSIONS), lead.interviewId, "whatsapp", { officePhone: OFFICE_PHONE })
    if (!first.ok) throw new Error(`release failed: ${first.error}`)
    const corrected = await recordInterviewResult(await signedIn(ADMISSIONS), lead.interviewId, {
      interviewDate: today,
      result: "Passed",
      score: 90,
    })
    if (!corrected.ok) throw new Error(`correction failed: ${corrected.error}`)
    const releases = async () => {
      const read = await getLatestResultRelease(await signedIn(ADMISSIONS), lead.interviewId)
      if (!read.ok) throw new Error(read.error)
      return read.data.count
    }
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>wa.me</title>" }))
    let tabs = 0
    context.on("page", () => tabs++)

    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(lead.id, "Interview"))
    const warning = release(page).getByRole("note", { name: "Changed since sent" })
    await expect(warning).toHaveText(
      "The result or score has been corrected since it was last sent, as Passed, 81.5%. Send it again so the family has the corrected result.",
    )
    await expect(release(page).getByRole("group", { name: "Message preview" })).toContainText("90%")

    // Cancelling records nothing and opens no tab.
    await release(page).getByRole("button", { name: "Send through WhatsApp" }).click()
    const dialog = page.getByRole("alertdialog", { name: "Send the result again?" })
    await expect(dialog).toContainText(`It was already sent by WhatsApp on ${formatDate(today)} at `)
    await expect(dialog).toContainText(
      `by ${ADMISSIONS.name}, as Passed, 81.5%. The result or score has been corrected since, so this sends the corrected result.`,
    )
    await dialog.getByRole("button", { name: "Don't send" }).click()
    await expect(dialog).toHaveCount(0)
    await release(page).getByRole("button", { name: "Send SMS instead" }).click()
    await expect(dialog).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(dialog).toHaveCount(0)
    expect(tabs).toBe(0)
    expect(await releases()).toBe(1)
    await expect(release(page).getByRole("status")).toHaveCount(0)

    // Confirming sends the corrected result, and the warning clears.
    await release(page).getByRole("button", { name: "Send SMS instead" }).click()
    await dialog.getByRole("button", { name: "Send again by SMS" }).click()
    await expect(release(page).getByRole("status")).toHaveText("Recorded as sent. Send this text from the office phone.", {
      timeout: 15_000,
    })
    await expect(release(page).getByRole("group", { name: "SMS text" })).toContainText("90%")
    await expect(release(page)).toContainText(`Sent by SMS on ${formatDate(today)} by ${ADMISSIONS.name}`)
    await expect(warning).toHaveCount(0)
    expect(await releases()).toBe(2)

    // With nothing changed, the confirmation says so, and confirming opens WhatsApp.
    await page.reload()
    await release(page).getByRole("button", { name: "Send through WhatsApp" }).click()
    await expect(dialog).toContainText(
      `It was already sent by SMS on ${formatDate(today)} at `,
    )
    await expect(dialog).toContainText("as Passed, 90%. Send it again only if the family lost the message or changed number.")
    const opened = page.waitForEvent("popup")
    await dialog.getByRole("button", { name: "Send again through WhatsApp" }).click()
    const tab = await opened
    await tab.waitForURL(/^https:\/\/wa\.me\//)
    await expect(release(page).getByRole("status")).toHaveText("Recorded as sent. WhatsApp opened in a new tab: press send there.")
    expect(await releases()).toBe(3)
  })
})

test.describe("a send from a stale page", () => {
  test("a page loaded before someone else sent the result is refused, records nothing and closes the WhatsApp tab", async ({
    page,
    context,
  }) => {
    const lead = await interviewedLead()
    await markPaid(lead.interviewId)
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>wa.me</title>" }))

    await signIn(page, ADMISSIONS)
    await page.goto(leadUrl(lead.id, "Interview"))
    await expect(release(page)).toContainText("Not sent yet.")

    // Someone else sends it while this page is open.
    const other = await releaseResult(await signedIn(ADMISSIONS), lead.interviewId, "sms", { officePhone: OFFICE_PHONE })
    if (!other.ok) throw new Error(`release failed: ${other.error}`)

    const opened = page.waitForEvent("popup")
    await release(page).getByRole("button", { name: "Send through WhatsApp" }).click()
    const tab = await opened
    await expect(release(page).getByRole("alert")).toHaveText(
      "This result was sent by someone else meanwhile, so nothing was sent. Reload to see it.",
      { timeout: 15_000 },
    )
    await expect.poll(() => tab.isClosed()).toBe(true)
    await expect(release(page).getByRole("status")).toHaveCount(0)

    const read = await getLatestResultRelease(await signedIn(ADMISSIONS), lead.interviewId)
    if (!read.ok) throw new Error(read.error)
    expect(read.data.count).toBe(1)
  })
})
