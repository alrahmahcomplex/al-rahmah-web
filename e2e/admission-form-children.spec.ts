import { expect, test } from "@playwright/test"

import { admissionYears } from "../lib/admission-form"
import { expectQuestion, family, fillStudent, nameBox, openQuestion, pickSomeoneElse, tile, PHONE_WIDTH, send, toSend, setLanguageCookie, WORDS } from "./admission-form"

// Several students on one Admission form (#75), on a phone, in Swahili,
// against local Supabase with Turnstile's always-pass test keys.

test.use({ viewport: PHONE_WIDTH })

const nextYear = String(admissionYears()[1])
const t = WORDS.sw

test.beforeEach(async ({ context }) => {
  await setLanguageCookie(context, "sw")
})

test("adds students up to eight with their labels, and removes one, keeping the others' entries", async ({ page }) => {
  // Eight students, three questions each.
  test.setTimeout(120_000)
  const who = family()
  const [a, b, c] = ["AMANI", "BARAKA", "CHAUSIKU"].map((first) => who.student(first))
  await page.goto("/apply")
  await fillStudent(page, "sw", a.typed, nextYear)
  await expect(page.getByText("Mwanafunzi wa pili")).toHaveCount(0)

  await openQuestion(page).getByRole("button", { name: t.addStudent }).click()
  await expectQuestion(page, t.secondStudentName)
  await expect(page.getByText("Mwanafunzi wa pili", { exact: true })).toBeVisible()
  await expect(page.getByRole("heading", { level: 3, name: "Wanafunzi", exact: true })).toBeVisible()
  // The second student's father boxes start empty (lead, 2026-11-17).
  await expect(openQuestion(page).getByRole("textbox", { name: t.firstBox, exact: true })).toHaveValue("")
  await fillStudent(page, "sw", b.typed, nextYear, { residence: "day" })
  await openQuestion(page).getByRole("button", { name: t.addStudent }).click()
  await fillStudent(page, "sw", c.typed, nextYear)

  await page.getByRole("button", { name: `Badilisha Taarifa, ${b.name}` }).click()
  // Let the folded line finish leaving before the next change (GuidedStack
  // keeps an item that is still folding away when the list changes again).
  await expect(page.getByRole("button", { name: `Badilisha Taarifa, ${b.name}` })).toHaveCount(0)
  await page.getByRole("button", { name: `Ondoa ${b.name}` }).click()
  await expect(page.getByText(b.name)).toHaveCount(0)
  // The first match is the folded line; the full-name line under the boxes stays in the page, folded away.
  await expect(page.getByText(new RegExp(`^${a.name}`)).first()).toBeVisible()
  await expect(page.getByText(new RegExp(`^${c.name}`)).first()).toBeVisible()

  for (let n = 3; n <= 8; n++) {
    await openQuestion(page).getByRole("button", { name: t.addStudent }).click()
    // The eighth student has no "another student?" question after it.
    await fillStudent(page, "sw", who.student(`MWANAFUNZI${"ABCDEFGH"[n - 1]}`).typed, nextYear, { last: n === 8 })
  }
  await expect(page.getByText("Unaweza kuomba kwa wanafunzi hadi 8 kwenye fomu moja.")).toBeVisible()
  await expect(page.getByRole("button", { name: t.addStudent })).toHaveCount(0)
})

test("the same student twice on one form is refused at the name, naming the student", async ({ page }) => {
  const who = family()
  await page.goto("/apply")
  await fillStudent(page, "sw", who.childTyped, nextYear)
  await openQuestion(page).getByRole("button", { name: t.addStudent }).click()
  await nameBox(page, "sw").fill(`  ${who.childTyped.toLowerCase()} `)
  await openQuestion(page).getByRole("button", { name: t.continue }).click()

  await expectQuestion(page, t.secondStudentName)
  await expect(openQuestion(page).getByText(`${who.child} yupo mara mbili kwenye fomu hii.`, { exact: false })).toBeVisible()
  await expect(nameBox(page, "sw")).toBeFocused()
})

test("two students on one form are sent together, and the confirmation lists each with its number", async ({ page }) => {
  const who = family()
  const brother = who.student("KAKA")
  await page.goto("/apply")
  await fillStudent(page, "sw", who.childTyped, nextYear)
  await openQuestion(page).getByRole("button", { name: t.addStudent }).click()
  await fillStudent(page, "sw", brother.typed, nextYear)
  await openQuestion(page).getByRole("button", { name: t.noMore }).click()
  await expectQuestion(page, t.parentName)
  await expect(page.getByText("Hakuna mwanafunzi mwingine")).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Ongeza Mwanafunzi", exact: true })).toBeVisible()
  await expect(openQuestion(page).getByText("Mtu anayewalea wanafunzi na kulipa ada ya shule.")).toBeVisible()
  await pickSomeoneElse(page, "sw")
  await nameBox(page, "sw", "first").fill(who.parent)
  await openQuestion(page).getByRole("button", { name: t.continue }).click()
  await expectQuestion(page, /ni nani kwa wanafunzi hawa\?$/)
  await tile(openQuestion(page), t.mother).click()
  await expectQuestion(page, t.phone)
  await openQuestion(page).getByLabel(t.phone).fill(who.phone)
  await openQuestion(page).getByRole("button", { name: t.continue }).click()
  await toSend(page, "sw")
  await expect(page.getByText("Wanafunzi 2", { exact: false })).toBeVisible()
  await send(page, "sw")

  await expect(page.getByRole("heading", { name: t.done })).toBeVisible()
  const listed = page.getByRole("listitem")
  await expect(listed).toHaveCount(2)
  await expect(listed.nth(0).getByText(who.child, { exact: true })).toBeVisible()
  await expect(listed.nth(0).getByText(/^ADMSN-\d{5}$/)).toBeVisible()
  await expect(listed.nth(1).getByText(brother.name, { exact: true })).toBeVisible()
  await expect(listed.nth(1).getByText(/^ADMSN-\d{5}$/)).toBeVisible()
  const numbers = await page.getByText(/^ADMSN-\d{5}$/).allTextContents()
  expect(new Set(numbers).size).toBe(2)
})
