import { expect, test, type Page } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { expectQuestion, family, openQuestion, PHONE_WIDTH, send, toCode, toSend, setLanguageCookie, WORDS, type Lang } from "./admission-form"

// The Discount code on the Admission form (#83), on a phone, against local
// Supabase with Turnstile's always-pass test keys. Slice 4's seeded agents:
// BJN-402 is Approved, ZNM-401 Pending; QQQ-000 is nobody's.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])
const THIRTY_DAYS = 30 * 24 * 60 * 60

// Fills `students` students and the custodian, and opens the Discount code question.
async function toReview(page: Page, lang: Lang, students = 1) {
  const who = family()
  await toCode(page, lang, who, nextYear, students)
  return who
}

const field = (page: Page, lang: Lang) => openQuestion(page).getByLabel(WORDS[lang].codeLabel)

async function rememberedCode(page: Page) {
  return (await page.context().cookies()).find((c) => c.name === "discount_code")
}

test("a Referral link fills in the code, remembers it for 30 days, and the fee drops for a confirmed code", async ({ page, context }) => {
  await setLanguageCookie(context, "sw")
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
  await expect(field(page, "sw")).toHaveValue("BJN-402")
  // The price box: the full fee against the live discount.
  await expect(openQuestion(page).getByText("Okoa TZS 10,000", { exact: true })).toBeVisible()
  await expect(openQuestion(page).getByText(/50,000 → 40,000/)).toBeVisible()
  await expect(openQuestion(page).getByText("Hongera! Umeokoa TZS 10,000 kwa kila mwanafunzi.")).toBeVisible()
  await expect(openQuestion(page).getByText("Ofa hii ni ya muda mfupi")).toBeVisible()

  await openQuestion(page).getByRole("button", { name: WORDS.sw.continue }).click()
  await expectQuestion(page, WORDS.sw.fee)
  await expect(openQuestion(page).getByText("TZS 40,000")).toHaveCount(2)
  await expect(openQuestion(page).getByText("Umeokoa TZS 10,000")).toBeVisible()
  await openQuestion(page).getByRole("button", { name: "Kuhusu ofa ya muda maalum" }).click()
  const sheet = page.getByRole("dialog", { name: "Ofa ya muda maalum" })
  await expect(sheet.getByText("Punguzo la TZS 10,000 kwa kila mwanafunzi ni la muda maalumu.")).toBeVisible()
  await sheet.getByRole("button", { name: "Sawa, nimeelewa" }).click()
  await expect(sheet).toHaveCount(0)
  await openQuestion(page).getByRole("button", { name: WORDS.sw.continue }).click()
  await expect(page.getByRole("button", { name: "Ofa ya muda maalum", exact: true })).toBeVisible()

  await send(page, "sw")
  await expect(page.getByRole("heading", { name: WORDS.sw.done })).toBeVisible()
  await expect(page.getByText("Punguzo lako la TZS 10,000 linakusubiri")).toBeVisible()
  await expect(page.getByText(/Ofa hii ni ya muda maalumu na inaweza kuondolewa wakati wowote/)).toBeVisible()
  // Sending leaves the code for another form.
  expect((await rememberedCode(page))?.value).toBe("BJN-402")
})

test("a return visit without the link still finds the code, and a later link replaces it", async ({ page, context }) => {
  await setLanguageCookie(context, "en")
  await page.goto("/apply?ref=BJN-402")
  await expect.poll(async () => (await rememberedCode(page))?.value).toBe("BJN-402")

  await page.goto("/apply")
  await toReview(page, "en")
  await expect(field(page, "en")).toHaveValue("BJN-402")

  await page.goto("/apply?ref=znm-401")
  await expect.poll(async () => (await rememberedCode(page))?.value).toBe("ZNM-401")
  await page.evaluate(() => window.sessionStorage.clear())
  await page.goto("/apply")
  await toReview(page, "en")
  await expect(field(page, "en")).toHaveValue("ZNM-401")
  await expect(page.getByText("This code is waiting to be confirmed. The discount applies if it is confirmed before you pay.")).toBeVisible()
  await toSend(page, "en")
  await expect(page.getByText(/^TZS 50,000 · 1 student$/)).toBeVisible()
})

test("each code's note, and the fee for several students", async ({ page, context }) => {
  await setLanguageCookie(context, "en")
  await page.goto("/apply")
  await toReview(page, "en", 3)
  const code = field(page, "en")
  await expect(code).toHaveValue("")

  await code.fill("qqq-000")
  await openQuestion(page).getByRole("button", { name: "Check Discount" }).click()
  await expect(page.getByText("We don't recognise this code. Check it, or send the form without it.")).toBeVisible()

  await code.fill(" zn m-401 ")
  await code.blur()
  await expect(page.getByText("This code is waiting to be confirmed. The discount applies if it is confirmed before you pay.")).toBeVisible()

  await code.fill("bjn-402")
  await code.blur()
  await expect(page.getByText("Well done! You save TZS 10,000 for each student.")).toBeVisible()
  await openQuestion(page).getByRole("button", { name: "Continue" }).click()
  await expectQuestion(page, "Interview fee")
  await expect(openQuestion(page).getByText("TZS 40,000")).toHaveCount(3)
  await expect(openQuestion(page).getByText("TZS 120,000")).toBeVisible()
  await expect(openQuestion(page).getByText("You save TZS 30,000")).toBeVisible()
})

test("an unrecognised code never stops the form", async ({ page, context }) => {
  await setLanguageCookie(context, "en")
  await page.goto("/apply?ref=QQQ-000")
  await toReview(page, "en")
  await expect(page.getByText("We don't recognise this code. Check it, or send the form without it.")).toBeVisible()

  // Continue stops once on the note, then goes on.
  await openQuestion(page).getByRole("button", { name: "Continue" }).click()
  await openQuestion(page).getByRole("button", { name: "Continue" }).click()
  await expectQuestion(page, "Interview fee")
  await openQuestion(page).getByRole("button", { name: "Continue" }).click()
  await send(page, "en")
  await expect(page.getByRole("heading", { name: WORDS.en.done })).toBeVisible()
})
