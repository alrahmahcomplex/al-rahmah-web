import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { E2E_PORT } from "./server"

import { admissionYears } from "../lib/admission-form"
import { FORM_NOTICE, FORM_NOTICE_VERSION, STAFF_REMINDER } from "../lib/referral-notice"
import { createLead } from "../lib/services/leads"
import { inRolledBackTransaction, secretClient } from "../tests/support/db"
import { ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { family, fillChild, fillParent, PHONE_WIDTH, waitForSecurityCheck, type Lang } from "./admission-form"

// The code-holder notice (#182): under the Admission form's Discount code
// whenever the field has a value, typed or filled in by a Referral link, in
// both languages; and the reminder staff see when they enter a code for a
// walk-in family. The codes are slice 4's seeded agents.

const nextYear = String(admissionYears()[1])
const FIELD = { sw: "Code ya Punguzo · si lazima", en: "Discount code · optional" } as const

async function useEnglish(page: Page) {
  await page.context().addCookies([{ name: "lang", value: "en", url: `http://localhost:${E2E_PORT}` }])
}

// Fills one parent and child and opens the review step, where the field is.
async function toReview(page: Page, lang: Lang) {
  const who = family()
  await fillParent(page, lang, who)
  await page.getByRole("button", { name: lang === "sw" ? "Endelea" : "Continue" }).click()
  await fillChild(page, lang, { child: who.child }, nextYear, page.getByRole("group", { name: lang === "sw" ? "Mtoto 1" : "Child 1" }))
  await page.getByRole("button", { name: lang === "sw" ? "Endelea" : "Continue" }).click()
  return who
}

async function noticeVersionOf(child: string): Promise<string | null> {
  const rows = await inRolledBackTransaction(
    async (sql) =>
      (await sql.query("select referral_notice_version as version from public.leads where student_name = $1", [child])).rows as {
        version: string | null
      }[],
  )
  if (rows.length !== 1) throw new Error(`expected one lead named ${child}, found ${rows.length}`)
  return rows[0].version
}

test.describe("the notice on the Admission form", () => {
  test.use({ viewport: PHONE_WIDTH })

  for (const lang of ["sw", "en"] as const) {
    test(`a typed code shows the notice in ${lang === "sw" ? "Swahili" : "English"}, and clearing it hides it`, async ({ page }) => {
      if (lang === "en") await useEnglish(page)
      await page.goto("/apply")
      await toReview(page, lang)
      const field = page.getByLabel(FIELD[lang])
      const notice = page.getByText(FORM_NOTICE[lang])

      // No code, no notice: the field stays optional.
      await expect(field).toHaveValue("")
      await expect(notice).toHaveCount(0)

      await field.fill("qqq-000")
      await expect(notice).toBeVisible()
      await expect(notice).toHaveAttribute("data-notice-version", FORM_NOTICE_VERSION)
      await expect(field).toHaveAttribute("aria-describedby", /discount-code-holder-notice/)

      await field.fill("")
      await expect(notice).toHaveCount(0)
    })

    test(`a Referral link's code shows the notice in ${lang === "sw" ? "Swahili" : "English"}, and the lead records its version`, async ({
      page,
    }) => {
      if (lang === "en") await useEnglish(page)
      await page.goto("/apply?ref=bjn-402")
      const who = await toReview(page, lang)
      await expect(page.getByLabel(FIELD[lang])).toHaveValue("BJN-402")
      await expect(page.getByText(FORM_NOTICE[lang])).toBeVisible()
      // Only the notice for the page's language shows.
      await expect(page.getByText(FORM_NOTICE[lang === "sw" ? "en" : "sw"])).toHaveCount(0)

      await waitForSecurityCheck(page)
      await page.getByRole("button", { name: lang === "sw" ? "Tuma maombi" : "Send application" }).click()
      await expect(page.getByRole("heading", { name: lang === "sw" ? "Maombi yamepokelewa!" : "Application received!" })).toBeVisible()
      expect(await noticeVersionOf(who.child)).toBe(FORM_NOTICE_VERSION)
    })
  }
})

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

test.describe("the reminder for staff", () => {
  test("New Student shows the reminder once a code is typed, and the lead records it", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto("/staff/check-in/new")
    await page.getByLabel("Full name").fill(`Parent ${randomUUID().slice(0, 6)}`)
    await page.getByLabel("Phone", { exact: true }).fill(`0 7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`)
    await page.getByRole("button", { name: "Continue" }).click()
    const child = `Child ${randomUUID().slice(0, 6)}`
    await page.getByLabel("Student's full name").fill(child)
    await page.getByRole("radio", { name: "STD 3" }).click()
    await page.getByRole("radio", { name: nextYear }).click()
    await page.getByRole("radio", { name: "Day", exact: true }).click()

    const code = page.getByLabel("Referral code (optional)")
    const reminder = page.getByText(STAFF_REMINDER)
    await expect(reminder).toHaveCount(0)
    await code.fill("bjn-402")
    await expect(reminder).toBeVisible()
    await expect(page.getByText(/^Baraka Juma Njoroge · /)).toBeVisible()

    await page.getByRole("button", { name: "Continue to review" }).click()
    await page.getByRole("button", { name: "Register student" }).click()
    await expect(page.getByRole("heading", { name: `${child} is registered` })).toBeVisible()
    expect(await noticeVersionOf(child)).toBe("staff_reminder")
  })
})

test("the lead's Referral code editor shows the reminder once a code is typed", async ({ page }) => {
  const pupil = `Pupil ${randomUUID().slice(0, 6)}`
  const created = await createLead(secretClient(), {
    guardian: {
      contact: { fullName: "Notice Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: pupil, className: "STD 2", enrollmentYear: Number(nextYear), dayOrBoarding: "Day" },
    start: { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)

  await signIn(page, ADMISSIONS)
  await page.goto(`/staff/leads/${created.data.leadId}`)
  const panel = page.getByRole("region", { name: "Referral code" })
  await panel.getByRole("button", { name: "Add a code" }).click()
  const reminder = panel.getByText(STAFF_REMINDER)
  await expect(reminder).toHaveCount(0)
  await panel.getByLabel("Referral code").fill("bjn-402")
  await expect(reminder).toBeVisible()
  await panel.getByRole("button", { name: "Save" }).click()
  await expect(panel.getByLabel("Code", { exact: true })).toHaveText("BJN-402")
  expect(await noticeVersionOf(pupil)).toBe("staff_reminder")
})
