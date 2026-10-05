import { expect, test, type Page } from "@playwright/test"

import { E2E_PORT } from "./server"

import { admissionYears } from "../lib/admission-form"
import { family, fillChild, fillParent, PHONE_WIDTH, waitForSecurityCheck, type Lang } from "./admission-form"

// The Discount code on the Admission form (#83), on a phone, against local
// Supabase with Turnstile's always-pass test keys. Slice 4's seeded agents:
// BJN-402 is Approved, ZNM-401 Pending; QQQ-000 is nobody's.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])
const THIRTY_DAYS = 30 * 24 * 60 * 60

const FIELD = { sw: "Code ya Punguzo · si lazima", en: "Discount code · optional" } as const

// Fills the parent and `children` children, and opens the review step.
async function toReview(page: Page, lang: Lang, children = 1) {
  const who = family()
  await fillParent(page, lang, who)
  await page.getByRole("button", { name: lang === "sw" ? "Endelea" : "Continue" }).click()
  for (let n = 1; n <= children; n++) {
    if (n > 1) await page.getByRole("button", { name: lang === "sw" ? "Ongeza mtoto mwingine" : "Add another child" }).click()
    const card = page.getByRole("group", { name: `${lang === "sw" ? "Mtoto" : "Child"} ${n}` })
    await fillChild(page, lang, { child: `${who.child} ${n}` }, nextYear, card)
  }
  await page.getByRole("button", { name: lang === "sw" ? "Endelea" : "Continue" }).click()
  return who
}

async function rememberedCode(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "discount_code")
}

async function useEnglish(page: Page) {
  await page.context().addCookies([{ name: "lang", value: "en", url: `http://localhost:${E2E_PORT}` }])
}

test("a Referral link fills in the code, remembers it for 30 days, and the fee drops for a confirmed code", async ({ page }) => {
  await page.goto("/apply?ref=bjn-402")
  // The page writes the cookie once it has loaded in the browser.
  await expect.poll(async () => (await rememberedCode(page))?.value).toBe("BJN-402")
  const cookie = await rememberedCode(page)
  expect(cookie?.sameSite).toBe("Lax")
  expect(cookie?.httpOnly).toBe(false)
  expect(cookie?.path).toBe("/")
  // Max-Age=30 days: the browser turns it into an expiry 30 days from now.
  expect(Math.abs(cookie!.expires - (Date.now() / 1000 + THIRTY_DAYS))).toBeLessThan(120)

  await toReview(page, "sw")
  await expect(page.getByLabel(FIELD.sw)).toHaveValue("BJN-402")
  await expect(page.getByText("Punguzo la TZS 20,000 kwenye ada ya usaili kwa kila mtoto.")).toBeVisible()
  await expect(page.getByText("TZS 30,000 kwa kila mtoto")).toBeVisible()
  await expect(page.getByText("Jumla: TZS 30,000")).toBeVisible()

  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: "Tuma maombi" }).click()
  await expect(page.getByRole("heading", { name: "Maombi yamepokelewa!" })).toBeVisible()
  await expect(page.locator("main")).not.toContainText("TZS")
  // Sending leaves the code for another form.
  expect((await rememberedCode(page))?.value).toBe("BJN-402")
})

test("a return visit without the link still finds the code, and a later link replaces it", async ({ page }) => {
  await useEnglish(page)
  await page.goto("/apply?ref=BJN-402")
  await expect.poll(async () => (await rememberedCode(page))?.value).toBe("BJN-402")

  await page.goto("/apply")
  await toReview(page, "en")
  await expect(page.getByLabel(FIELD.en)).toHaveValue("BJN-402")

  await page.goto("/apply?ref=znm-401")
  await expect.poll(async () => (await rememberedCode(page))?.value).toBe("ZNM-401")
  await page.goto("/apply")
  await toReview(page, "en")
  await expect(page.getByLabel(FIELD.en)).toHaveValue("ZNM-401")
  await expect(
    page.getByText("This code is waiting to be confirmed. The discount applies if it is confirmed before you pay."),
  ).toBeVisible()
  await expect(page.getByText("TZS 50,000 per child")).toBeVisible()
})

test("each code's note, and the fee for several children", async ({ page }) => {
  await useEnglish(page)
  await page.goto("/apply")
  await toReview(page, "en", 3)
  const field = page.getByLabel(FIELD.en)
  await expect(field).toHaveValue("")
  await expect(page.getByText("TZS 50,000 per child")).toBeVisible()
  await expect(page.getByText("Total for 3 children: TZS 150,000")).toBeVisible()

  await field.fill("qqq-000")
  await field.blur()
  await expect(page.getByText("We don't recognise this code. Check it, or send the form without it.")).toBeVisible()
  await expect(page.getByText("Total for 3 children: TZS 150,000")).toBeVisible()

  await field.fill(" zn m-401 ")
  await field.blur()
  await expect(
    page.getByText("This code is waiting to be confirmed. The discount applies if it is confirmed before you pay."),
  ).toBeVisible()
  await expect(page.getByText("Total for 3 children: TZS 150,000")).toBeVisible()

  await field.fill("bjn-402")
  await field.blur()
  await expect(page.getByText("TZS 20,000 off the interview fee for each child.")).toBeVisible()
  await expect(page.getByText("TZS 30,000 per child")).toBeVisible()
  await expect(page.getByText("Total for 3 children: TZS 90,000")).toBeVisible()
})

test("an unrecognised code never stops the form", async ({ page }) => {
  await useEnglish(page)
  await page.goto("/apply?ref=QQQ-000")
  await toReview(page, "en")
  await expect(page.getByText("We don't recognise this code. Check it, or send the form without it.")).toBeVisible()

  await waitForSecurityCheck(page)
  await page.getByRole("button", { name: "Send application" }).click()
  await expect(page.getByRole("heading", { name: "Application received!" })).toBeVisible()
})
