import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, type LeadClass } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { linkSibling } from "@/lib/services/sibling-groups"
import { decideSiblingRequest, requestSiblingDiscount } from "@/lib/services/sibling-requests"

import { asSystem, signedIn } from "../tests/support/db"
import { claimFeeYear, type FeeYearClaim } from "../tests/support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, type FixtureStaff } from "../tests/support/fixtures"
import { leadUrl } from "./lead-page"
import { signInOnce } from "./log-in"

// The Accountant's Sibling fee edit (#311): Edit fee shows what each
// sibling would pay before saving and needs a reason; "Granted: fee edit
// needed" can be closed with "Leave the fee as it is" and a reason; the
// payment form says a waiting Sibling request leaves the fee in full; staff
// who don't record payments see no edit. Each test makes its own families
// in a year it claims.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))
const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(0, 26))).join("")
const father = () => `ALI${letters(4)} MUSSA${letters(4)} KHAMIS${letters(4)}`

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

let claims: FeeYearClaim[] = []
test.afterEach(async () => {
  await Promise.all(claims.map((claim) => claim.release()))
  claims = []
})

async function yearWithSchedule() {
  const claim = await claimFeeYear()
  claims.push(claim)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error("schedule failed")
  return claim.year
}

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

async function child(year: number, first: string, fatherName: string, className: LeadClass) {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: `Fee Edit Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `${first} ${fatherName}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, year]))
  return created.data.leadId
}

async function linked(leadId: string, siblingOfLeadId: string) {
  const answer = await linkSibling(await signedIn(ADMISSIONS), { leadId, siblingOfLeadId })
  if (!answer.ok || answer.data.kind !== "linked") throw new Error(`link failed: ${JSON.stringify(answer)}`)
}

async function asked(leadId: string) {
  const sent = await requestSiblingDiscount(await signedIn(ADMISSIONS), { leadId, note: "Both birth certificates.", requestId: randomUUID() })
  if (!sent.ok) throw new Error(`request failed: ${JSON.stringify(sent.error)}`)
  return sent.data
}

const schoolFee = (page: Page) => page.getByRole("region", { name: "School fee", exact: true })

test.describe("the Sibling fee edit", () => {
  test("the Accountant sees each sibling's fee before saving, and the reason is required", async ({ page }) => {
    const year = await yearWithSchedule()
    const name = father()
    const khalid = await child(year, `KHALID${letters(3)}`, name, "FORM 1")
    const zuhura = `ZUHURA${letters(3)}`
    await linked(await child(year, zuhura, name, "KG 1"), khalid)

    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(khalid, "School fee"))
    await schoolFee(page).getByRole("button", { name: "Edit fee" }).click()
    const form = page.getByRole("form", { name: "Edit fee" })
    await form.locator("label").filter({ hasText: "Sibling 10%" }).click()

    const rows = form.getByRole("listitem")
    await expect(rows).toHaveCount(2)
    await expect(rows.nth(0)).toContainText("this student")
    await expect(rows.nth(0)).toContainText("TZS 2,520,000")
    await expect(rows.nth(0)).toContainText("was TZS 2,800,000")
    // Khalid no longer pays full, so Zuhura does.
    await expect(rows.nth(1)).toContainText(zuhura)
    await expect(rows.nth(1)).toContainText("TZS 1,100,000")
    await expect(rows.nth(1)).toContainText("Full fee")
    await expect(rows.nth(1)).toContainText("was TZS 990,000")

    await form.getByRole("button", { name: "Save the fee" }).click()
    await expect(form.getByRole("alert")).toHaveText("Choose the reason.")
    await form.getByRole("button", { name: "Sibling proof after enrolment" }).click()
    await form.getByRole("textbox", { name: "Note, optional" }).fill("Certificates seen")
    await form.getByRole("button", { name: "Save the fee" }).click()
    await expect(page.getByText("Fee saved. The change and its reason are in the audit log.")).toBeVisible()
    await expect(schoolFee(page)).toContainText("Set by hand by")
    await expect(schoolFee(page)).toContainText("Sibling proof after enrolment · Certificates seen")
  })

  test("Granted: fee edit needed is left as it is with a reason", async ({ page }) => {
    const year = await yearWithSchedule()
    const anchor = await child(year, `LATIFA${letters(3)}`, father(), "FORM 1")
    const saidi = await child(year, `SAIDI${letters(3)}`, father(), "STD 2")
    // Enrolled at the full fee, before any Sibling group: a payment needs a passed interview.
    const registered = await registerForInterview(await signedIn(ADMISSIONS), saidi)
    if (!registered.ok) throw new Error("registration failed")
    const result = await recordInterviewResult(await signedIn(ADMISSIONS), registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
    if (!result.ok) throw new Error("result failed")
    const fee = await getLeadFee(await signedIn(ADMISSIONS), saidi)
    if (!fee.ok || fee.data.kind !== "fee") throw new Error("no fee")
    const paid = await recordPayment(await signedIn(ACCOUNTANT), saidi, { type: "full_payment", amount: fee.data.schoolFee, paidOn: today }, randomUUID())
    if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
    await linked(saidi, anchor)
    const granted = await decideSiblingRequest(await signedIn(MANAGER), await asked(saidi), { decision: "grant" })
    if (!granted.ok) throw new Error("grant failed")

    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(saidi, "School fee"))
    await expect(schoolFee(page).getByText("Granted: fee edit needed")).toBeVisible()
    await schoolFee(page).getByRole("button", { name: "Leave the fee as it is" }).click()
    const form = page.getByRole("form", { name: "Leave the fee as it is" })
    await form.getByRole("button", { name: "Save" }).click()
    await expect(form.getByRole("alert")).toHaveText("Write why the fee stays as it is.")
    await form.getByRole("textbox", { name: "Why does the fee stay as it is?" }).fill("The invoice is already sent.")
    await form.getByRole("button", { name: "Save" }).click()
    await expect(page.getByText("Saved. The fee stays as it is.")).toBeVisible()
    await expect(schoolFee(page).getByText("Granted: fee edit needed")).toHaveCount(0)
  })

  test("while a request waits, the payment form says so; staff who don't record payments see no edit", async ({ page, browser }) => {
    const year = await yearWithSchedule()
    const latifa = `LATIFA${letters(3)}`
    const bakari = `BAKARI${letters(3)}`
    const anchor = await child(year, latifa, father(), "STD 6")
    const waiting = await child(year, bakari, father(), "STD 2")
    await linked(waiting, anchor)
    await asked(waiting)

    await signIn(page, ACCOUNTANT)
    await page.goto(leadUrl(waiting, "School fee"))
    await schoolFee(page).getByRole("button", { name: "Record payment" }).click()
    await expect(schoolFee(page)).toContainText(
      `A Sibling request for ${bakari} and ${latifa} is waiting. Recorded at the full fee for now. If the request is granted, the fee can be edited.`,
    )

    // The Applicants list says a request waits; the desk's side sheet has no Edit fee.
    const desk = await (await browser.newContext()).newPage()
    await signIn(desk, ADMISSIONS)
    await desk.goto(`/staff/applicants?q=${bakari}`)
    const row = desk.getByRole("row", { name: new RegExp(bakari) })
    await expect(row).toContainText("Full fee for now")
    await expect(row).toContainText("Request waiting")
    await row.click()
    const sheet = desk.getByRole("dialog", { name: new RegExp(bakari) })
    await expect(sheet.getByRole("heading", { name: "Sibling group" })).toBeVisible()
    await expect(sheet.getByRole("button", { name: "Edit fee" })).toHaveCount(0)
  })
})
