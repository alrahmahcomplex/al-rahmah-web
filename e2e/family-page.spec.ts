import { randomInt } from "node:crypto"

import type { Page } from "@playwright/test"

import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { signedIn } from "../tests/support/db"

import { signInOnce } from "./log-in"
import { expect, test } from "./staff-test"

// The Family page (#512): the students one Register students save made, on
// one page, where staff change any answer through the record's own actions.
// Each test registers its own family with names and numbers of its own.

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(26))).join("")
const mobile = () => `07${String(randomInt(10_000_000, 100_000_000))}`

type Family = { href: string; ids: string[]; names: string[]; last: string; otherLast: string }

// Two siblings on their mother, and a relative's child whose father is the custodian.
async function registerFamily(): Promise<Family> {
  const last = `M${letters(6)}`
  const otherLast = `S${letters(6)}`
  const first = [`N${letters(5)}`, `H${letters(5)}`, `Z${letters(5)}`]
  const student = (name: string, fatherFirst: string, fatherLast: string, className: string, custodian: object, extra: object = {}) => ({
    first_name: name,
    father_first: fatherFirst,
    father_middle: "SALIM",
    father_last: fatherLast,
    class_name: className,
    enrollment_year: new Date().getFullYear() + 1,
    day_or_boarding: "Day",
    custodian,
    brought_by: null,
    // STD 2 and up are asked their previous school.
    previous_school: className.startsWith("STD") && className !== "STD 1" ? { name: "EXAMPLE PRIMARY SCHOOL", type: "public", region: "Dar es Salaam" } : null,
    sibling_of: null,
    not_a_sibling: false,
    sibling_father_full_name: null,
    name_answer: null,
    request_note: null,
    request_id: null,
    ...extra,
  })
  const client = await signedIn(ADMISSIONS)
  const { data, error } = await client.rpc("register_students", {
    visited_on: new Date().toISOString().slice(0, 10),
    people: [
      { first_name: "MWANAIDI", middle_name: "SALIM", last_name: last, phone: mobile(), whatsapp: null },
      { first_name: "RASHIDI", middle_name: "KOMBO", last_name: otherLast, phone: mobile(), whatsapp: null },
    ],
    students: [
      student(first[0], "JUMA", last, "STD 5", { person: 1, relationship: "Mother", relationship_description: null }),
      student(first[1], "JUMA", last, "KG 2", { person: 1, relationship: "Mother", relationship_description: null }, { sibling_of: { student: 1 } }),
      student(first[2], "RASHIDI", otherLast, "STD 3", { person: 2, father: true }),
    ],
  })
  if (error) throw new Error(`Could not register the family: ${error.message} ${error.details ?? ""}`)
  if (data.result !== "created") throw new Error(`The family was not registered: ${JSON.stringify(data)}`)
  const ids = (data.students as { lead_id: string }[]).map((s) => s.lead_id)
  return {
    href: `/staff/family?students=${ids.join(",")}`,
    ids,
    names: [`${first[0]} JUMA ${last}`, `${first[1]} JUMA ${last}`, `${first[2]} RASHIDI ${otherLast}`],
    last,
    otherLast,
  }
}

async function open(page: Page, person: FixtureStaff, href: string) {
  await signInOnce(page, person.email, person.password)
  await page.goto(href)
}

// One student's card, and the value of one of its answers.
const card = (page: Page, name: string) => page.getByRole("region", { name, exact: true })
const answer = (page: Page, name: string, key: string) => card(page, name).locator("dt", { hasText: key }).locator("xpath=following-sibling::dd[1]")

test("staff change a student's name, class and custodian on one page", async ({ page }) => {
  const family = await registerFamily()
  await open(page, ADMISSIONS, family.href)

  const [a, b, c] = family.names.map((n) => n.charAt(0) + n.split(" ")[0].slice(1).toLowerCase())
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`The family of ${a}, ${b} and ${c}`)
  await expect(answer(page, family.names[0], "Father")).toHaveText(`JUMA SALIM ${family.last}`)

  // The student's own name: the full name follows.
  const renamed = `A${letters(5)}`
  await card(page, family.names[0]).getByRole("button", { name: `Change the name of ${family.names[0]}` }).click()
  const nameSheet = page.getByRole("dialog", { name: "Change the name" })
  await nameSheet.getByPlaceholder("Student’s name").fill(renamed)
  await expect(nameSheet).toContainText(`Student’s full name: ${renamed} JUMA ${family.last}`)
  await nameSheet.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Name saved." })).toBeVisible()
  const newName = `${renamed} JUMA ${family.last}`
  await expect(answer(page, newName, "Full name")).toHaveText(newName)

  // The class.
  await card(page, newName).getByRole("button", { name: `Change the class of ${newName}` }).click()
  await page.getByRole("dialog", { name: "Choose a class" }).getByRole("button", { name: "STD 6", exact: true }).click()
  await expect(page.getByRole("status").filter({ hasText: "Class changed to STD 6." })).toBeVisible()
  await expect(answer(page, newName, "Class")).toHaveText("STD 6")

  // The custodian's mobile number, once for both of the mother's children.
  const custodians = page.getByRole("region", { name: "Custodians" })
  await custodians.getByRole("button", { name: `Change the custodian MWANAIDI SALIM ${family.last}` }).click()
  const custodianSheet = page.getByRole("dialog", { name: "Change the custodian" })
  const number = mobile()
  await custodianSheet.getByLabel("Mobile number", { exact: true }).fill(number)
  await custodianSheet.getByRole("button", { name: "Save" }).click()
  await expect(page.getByRole("status").filter({ hasText: "Custodian saved." })).toBeVisible()
  await expect(custodians).toContainText(number.slice(1))

  // The changes are on each student's own record.
  await page.goto(`/staff/applicants/${family.ids[0]}`)
  await expect(page.getByRole("heading", { level: 1 })).toContainText(newName)
})

test("a father's name changed on the page renames the student", async ({ page }) => {
  const family = await registerFamily()
  await open(page, ADMISSIONS, family.href)

  const name = family.names[2]
  await card(page, name).getByRole("button", { name: `Change the father’s name of ${name}` }).click()
  const sheet = page.getByRole("dialog", { name: "Change the name" })
  const newLast = `K${letters(6)}`
  await sheet.getByPlaceholder("Last name").fill(newLast)
  await sheet.getByRole("button", { name: "Save" }).click()

  const renamed = name.replace(family.otherLast, newLast)
  await expect(answer(page, renamed, "Father")).toHaveText(`RASHIDI SALIM ${newLast}`)
  await expect(answer(page, renamed, "Full name")).toHaveText(renamed)
})

test("Register for interview puts one student on the list and leaves the others", async ({ page }) => {
  const family = await registerFamily()
  await open(page, ADMISSIONS, family.href)

  const [first, second] = family.names
  await card(page, first).getByRole("button", { name: "Register for interview" }).click()
  await expect(card(page, first).getByText("Registered for interview")).toBeVisible()
  await expect(card(page, first).getByRole("button", { name: "Register for interview" })).toHaveCount(0)
  await expect(card(page, second).getByRole("button", { name: "Register for interview" })).toBeVisible()
})

test("staff who may not edit read the family without Change", async ({ page }) => {
  const family = await registerFamily()
  await open(page, ACCOUNTANT, family.href)

  await expect(card(page, family.names[0])).toBeVisible()
  await expect(page.getByRole("main").getByRole("button", { name: /^Change/ })).toHaveCount(0)
  await expect(page.getByRole("main").getByRole("button", { name: "Give the answer" })).toHaveCount(0)
  await expect(page.getByRole("main").getByRole("button", { name: "Register for interview" })).toHaveCount(0)
})

test("an address naming a student the page can't show is not found", async ({ page }) => {
  const family = await registerFamily()
  await open(page, ADMISSIONS, `/staff/family?students=${family.ids[0]},00000000-0000-4000-8000-000000000000`)
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible()

  await page.goto(`/staff/family?students=${family.ids[0]}`)
  await expect(page.getByRole("heading", { name: "This page does not exist" })).toBeVisible()
})
