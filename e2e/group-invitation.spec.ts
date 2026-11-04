import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { renderGroupInvitation } from "@/lib/group-invitation"
import { formatDate, tanzaniaToday } from "@/lib/school-calendar"
import { sendGroupInvitation } from "@/lib/services/group-invitations"
import { setGroupLink } from "@/lib/services/group-links"
import { createLead } from "@/lib/services/leads"
import { buildWhatsAppLink } from "@/lib/whatsapp"

import { asSystem, inRolledBackTransaction, signedIn } from "../tests/support/db"
import { ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"

// Sending the admissions WhatsApp group invitation from a lead's screen
// (#186). Each test moves its leads to an Enrollment year of its own, so its
// group link reaches no other lead. The wa.me tab is checked by its address
// and never reaches WhatsApp.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

// 2030 to 2098: clear of real leads' years and of the group-links spec's 2099.
async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ year: number }>(
      `select year from generate_series(2030, 2098) as year
       where not exists (select 1 from public.whatsapp_group_links where enrollment_year = year)
         and not exists (select 1 from public.leads where enrollment_year = year)
       order by random() limit 1`,
    )
    if (!rows.length) throw new Error("No unused group-invitation year remains. Reset the local test database.")
    return rows[0].year
  })
}

const inviteLink = () => `https://chat.whatsapp.com/${randomUUID().replaceAll("-", "").slice(0, 22)}`
const mobile = () => `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
const spaced = (local: string) => `+255 ${local.slice(1, 4)} ${local.slice(4, 7)} ${local.slice(7)}`

async function saveLink(year: number, link = inviteLink(), seen: string | null = null) {
  const saved = await setGroupLink(await signedIn(MANAGER), year, link, seen)
  if (!saved.ok) throw new Error(`could not save the link: ${saved.error}`)
  return link
}

async function visitedLead(year: number, options: { contactId?: string; whatsapp?: string } = {}) {
  const studentName = `Invitee ${randomUUID().slice(0, 6)}`
  const phone = mobile()
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: options.contactId
      ? { contactId: options.contactId }
      : { contact: { fullName: "Invitation Parent", relationship: "Father", phone, whatsapp: options.whatsapp } },
    student: { fullName: studentName, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const contactId = await asSystem(async (sql) => {
    await sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year])
    return (await sql.query<{ id: string }>("select guardian_contact_id as id from public.leads where id = $1", [id])).rows[0].id
  })
  return { id, studentName, phone, contactId }
}

function message(year: number, link: string) {
  const rendered = renderGroupInvitation(year, link)
  if (!rendered.ok) throw new Error("the expected invitation could not be rendered")
  return rendered.data
}

const panel = (page: Page) => page.getByRole("region", { name: "WhatsApp group invitation" })
const sentToday = (year: number) => `Invitation to the ${year} group sent on ${formatDate(today)} by ${ADMISSIONS.name}`

test.describe("the group invitation on a lead's screen", () => {
  test.beforeEach(async ({ context }) => {
    await context.route("https://wa.me/**", (route) => route.fulfill({ status: 200, contentType: "text/html", body: "<title>wa.me</title>" }))
  })

  for (const channel of ["whatsapp", "phone"] as const) {
    test(`sends through WhatsApp to the ${channel === "whatsapp" ? "WhatsApp contact" : "direct phone"}, records it, and stays available`, async ({
      page,
    }) => {
      const year = await unusedYear()
      const link = await saveLink(year)
      const whatsapp = channel === "whatsapp" ? mobile() : undefined
      const lead = await visitedLead(year, { whatsapp })
      const number = whatsapp ?? lead.phone

      await signIn(page, ADMISSIONS)
      await page.goto(`/staff/leads/${lead.id}`)
      await expect(panel(page)).toContainText("No invitation sent yet.")
      await expect(panel(page)).toContainText(
        channel === "whatsapp" ? `To the WhatsApp number ${spaced(number)}.` : `To the direct phone ${spaced(number)},`,
      )
      await expect(panel(page).getByRole("group", { name: "Invitation preview" })).toHaveText(message(year, link), {
        useInnerText: true,
      })

      const expected = buildWhatsAppLink(message(year, link), `255${number.slice(1)}`)
      if (!expected.ok) throw new Error("the expected link could not be built")
      const leadUrl = page.url()
      const opened = page.waitForEvent("popup")
      await panel(page).getByRole("button", { name: "Send WhatsApp group invitation" }).click()
      const tab = await opened
      await tab.waitForURL(/^https:\/\/wa\.me\//)
      expect(tab.url()).toBe(expected.data)

      await expect(panel(page).getByRole("status")).toHaveText("Recorded as sent. WhatsApp opened in a new tab: press send there.")
      await expect(panel(page)).toContainText(`${sentToday(year)}.`)
      await expect(panel(page)).not.toContainText(/received|joined/i)
      expect(page.url()).toBe(leadUrl)
      await expect(panel(page).getByRole("button", { name: "Send WhatsApp group invitation" })).toBeVisible()

      await page.goto(`/staff/leads/${lead.id}/history`)
      await expect(page.getByText("sent the WhatsApp group invitation")).toBeVisible()
    })
  }

  test("with no Tanzanian mobile on file, staff copy the invitation and it is recorded once copied", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"])
    const year = await unusedYear()
    const link = await saveLink(year)
    const lead = await visitedLead(year)
    await asSystem((sql) =>
      sql.query("update public.guardian_contacts set phone = '+255222123456', whatsapp = '+255222123456' where id = $1", [
        lead.contactId,
      ]),
    )

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)
    await expect(panel(page)).toContainText("No WhatsApp number on file. Copy the invitation to send it yourself.")
    await expect(panel(page).getByRole("button", { name: "Send WhatsApp group invitation" })).toHaveCount(0)

    await panel(page).getByRole("button", { name: "Copy invitation" }).click()
    await expect(panel(page).getByRole("status")).toHaveText("Copied and recorded as sent. Paste it into a message to the family.")
    // Windows hands clipboard text back with CRLF line ends.
    const copied = await page.evaluate(() => navigator.clipboard.readText())
    expect(copied.replace(/\r\n/g, "\n")).toBe(message(year, link))
    await expect(panel(page)).toContainText(`${sentToday(year)}.`)
  })

  test("with no link saved for the year, the button says so and opens the setting", async ({ page }) => {
    const year = await unusedYear()
    const lead = await visitedLead(year)

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${lead.id}`)
    await expect(panel(page).getByRole("button", { name: "Send WhatsApp group invitation" })).toHaveCount(0)
    await panel(page).getByRole("link", { name: `No group link saved for ${year}: save one` }).click()
    await expect(page).toHaveURL(`/staff/group-links?year=${year}`)
    await expect(page.getByRole("heading", { name: `Admissions ${year}` })).toBeVisible()
  })

  test("a sibling shows the invitation with the child it went with; a replaced link marks both and the filter finds them", async ({
    page,
  }) => {
    const year = await unusedYear()
    const first = await saveLink(year)
    const sender = await visitedLead(year)
    const sibling = await visitedLead(year, { contactId: sender.contactId })
    const sent = await sendGroupInvitation(await signedIn(ADMISSIONS), sender.id, "link", first, year)
    if (!sent.ok) throw new Error(`send failed: ${sent.error}`)

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${sibling.id}`)
    await expect(panel(page)).toContainText(`${sentToday(year)} (with ${sender.studentName}).`)
    await expect(panel(page)).not.toContainText("Sent with an earlier link")

    await page.goto(`/staff/group-links?year=${year}`)
    await expect(page.getByText("1 family invited, not group members.")).toBeVisible()

    await saveLink(year, inviteLink(), first)
    for (const id of [sibling.id, sender.id]) {
      await page.goto(`/staff/leads/${id}`)
      await expect(panel(page)).toContainText("Sent with an earlier link. Send it again to give the family the current one.")
    }

    await page.goto("/staff/leads")
    await page.getByLabel("Group invitation").selectOption(String(year))
    await expect(page).toHaveURL(`/staff/leads?earlier_link=${year}`)
    const rows = page.getByRole("table", { name: "Leads" }).getByRole("row")
    await expect(rows).toHaveCount(3)
    await expect(page.getByRole("link", { name: sender.studentName })).toBeVisible()
    await expect(page.getByRole("link", { name: sibling.studentName })).toBeVisible()

    await page.screenshot({ path: "test-results/186-earlier-link-filter.png", fullPage: true })
    await page.goto(`/staff/leads/${sender.id}`)
    await page.screenshot({ path: "test-results/186-lead-invitation-desktop.png", fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: "test-results/186-lead-invitation-mobile.png", fullPage: true })
  })
})
