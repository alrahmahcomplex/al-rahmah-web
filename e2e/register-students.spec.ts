import { randomInt } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"
import { inRolledBackTransaction } from "../tests/support/db"
import { signInOnce } from "./log-in"

// Register students (#308, prototype v38), as Admissions Staff use it. Every
// run invents its own names and phone numbers, so runs never collide with
// each other or with the seeded leads.

async function signIn(page: Page, person: FixtureStaff) {
  await signInOnce(page, person.email, person.password)
  await expect(page).toHaveURL(/\/staff$/)
}

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(0, 26))).join("")
const word = (start: string) => `${start}${letters(4)}`
const phone = () => `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
type Father = [string, string, string]
const father = (): Father => [word("JUMA"), word("SALIM"), word("MRISHO")]
const full = (first: string, f: Father) => `${first} ${f[0]} ${f[2]}`

const open = (page: Page) => page.locator(".gf-step.gf-open")
const go = (page: Page, name: string | RegExp) => open(page).getByRole("button", { name, exact: typeof name === "string" })
// A tile's radio sits under its label, so the label is what takes the click.
const pick = (page: Page, name: string | RegExp, within = open(page)) =>
  within.locator("label").filter({ has: page.getByRole("radio", { name, exact: typeof name === "string" }) }).click()

async function start(page: Page) {
  await page.goto("/staff")
  await page.getByRole("link", { name: "Register students" }).first().click()
  await expect(page.getByRole("heading", { name: "Register students", level: 1 })).toBeVisible()
  await expect(page.getByRole("heading", { name: "What is the student’s name?" })).toBeVisible()
}

async function student(page: Page, first: string, f: Father, cls: { tab: string; name: string } | "FORM 1", board: "Day" | "Boarding") {
  const step = open(page)
  await step.getByRole("textbox", { name: "Student’s name" }).fill(first)
  await step.getByRole("textbox", { name: "First name" }).fill(f[0])
  await step.getByRole("textbox", { name: "Middle name" }).fill(f[1])
  await step.getByRole("textbox", { name: "Last name" }).fill(f[2])
  await expect(step.getByText(`Student’s full name: ${full(first, f)}`)).toBeVisible()
  await go(page, "Continue").click()

  if (cls === "FORM 1") await go(page, /FORM 1/).click()
  else {
    await go(page, "Choose another class").click()
    const sheet = page.getByRole("dialog", { name: "Choose a class" })
    await sheet.getByRole("tab", { name: cls.tab }).click()
    await sheet.getByRole("button", { name: cls.name, exact: true }).click()
  }
  await pick(page, board)
  // From STD 2 the previous school is asked.
  if (cls === "FORM 1" || cls.name !== "STD 1") await go(page, "Not known yet").click()
}

async function another(page: Page) {
  await go(page, "Yes, add a student").click()
  await expect(open(page).getByRole("heading", { name: "What is the next student’s name?" })).toBeVisible()
}

async function fatherCustodian(page: Page, number: string) {
  const step = open(page)
  await step.getByRole("switch", { name: "The father is the custodian" }).click()
  await step.getByRole("textbox", { name: "Custodian’s mobile number" }).fill(number)
  await go(page, "Continue").click()
}

async function finish(page: Page, n: number) {
  await go(page, /NO CODE/).click()
  await go(page, "Looks right").click()
  await go(page, `Register ${n} ${n === 1 ? "student" : "students"}`).click()
}

async function siblingResult(name: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query(
      `select l.status, l.custodian_relationship as rel, l.custodian_relationship_description as rel_desc, l.brought_by_name as brought,
              l.previous_school_not_known as school_unknown, coalesce(r.result, 'none') as result
         from public.leads l left join public.lead_sibling_results r on r.lead_id = l.id
        where l.student_name = $1`,
      [name],
    )
    if (rows.length !== 1) throw new Error(`expected one lead named ${name}, found ${rows.length}`)
    return rows[0] as { status: string; rel: string; rel_desc: string | null; brought: string | null; school_unknown: boolean; result: string }
  })
}

test.describe("registering a family", () => {
  // Each test answers a whole form, some two.
  test.describe.configure({ timeout: 120_000 })

  test("three children: two siblings and a relative's child, in one save", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    const dad = father()
    const other = father()
    const [neema, hamisi, zawadi] = [word("NEEMA"), word("HAMISI"), word("ZAWADI")]

    await student(page, neema, dad, { tab: "Primary", name: "STD 5" }, "Day")
    await another(page)
    await student(page, hamisi, dad, "FORM 1", "Boarding")
    await expect(page.getByRole("heading", { name: new RegExp(`^${hamisi} and ${neema} have the same father’s name`) })).toBeVisible()
    await pick(page, new RegExp(`^Yes, sibling of ${full(neema, dad)}`))
    await expect(page.getByText("Same father’s name. The 10% sibling discount applies.")).toBeVisible()
    await another(page)
    await student(page, zawadi, other, { tab: "Primary", name: "STD 3" }, "Day")
    await pick(page, /^Not a sibling/)
    await go(page, "No, go to custodians").click()

    // The siblings' custodian, then the relative's child's: the same person as before, as their aunt.
    await expect(page.getByRole("heading", { name: `Who is the custodian of ${neema} and ${hamisi}?` })).toBeVisible()
    await fatherCustodian(page, phone())
    await expect(page.getByRole("heading", { name: `Who is the custodian of ${zawadi}?` })).toBeVisible()
    await pick(page, new RegExp(`^${dad.join(" ")}`))
    await pick(page, "Uncle")
    await go(page, "Continue").click()
    await pick(page, new RegExp(`^${dad.join(" ")}`))

    await go(page, /NO CODE/).click()
    await expect(page.getByRole("heading", { name: "Check the fees and the sibling discount" })).toBeVisible()
    const fees = open(page).getByRole("table")
    await expect(fees.getByRole("row", { name: new RegExp(full(hamisi, dad)) })).toContainText("Pays full · highest fee")
    await expect(fees.getByRole("row", { name: new RegExp(full(neema, dad)) })).toContainText("Sibling 10% · same father")
    await expect(fees.getByRole("row", { name: new RegExp(full(zawadi, other)) })).toContainText("No discount")
    await go(page, "Looks right").click()
    await go(page, "Register 3 students").click()

    await expect(page.getByRole("heading", { name: "3 students registered" })).toBeVisible({ timeout: 15_000 })
    for (const name of [full(neema, dad), full(hamisi, dad), full(zawadi, other)]) await expect(page.getByText(name)).toBeVisible()
    await expect(page.getByText("The 10% sibling discount is on 1 student.")).toBeVisible()
    await expect(page.getByText("3 previous schools are saved as Not known yet.", { exact: false })).toBeVisible()

    expect(await siblingResult(full(neema, dad))).toMatchObject({ status: "Visited", rel: "Father", result: "ten", brought: dad.join(" "), school_unknown: true })
    expect(await siblingResult(full(hamisi, dad))).toMatchObject({ rel: "Father", result: "full" })
    expect(await siblingResult(full(zawadi, other))).toMatchObject({ rel: "Other", rel_desc: "Uncle", result: "none" })
  })

  test("close fathers' names ask once: a typing mistake makes them siblings", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    const dad = father()
    const typo: Father = [dad[0], dad[1], `${dad[2].slice(0, -1)}`]
    const [a, b] = [word("NEEMA"), word("HAMISI")]
    await student(page, a, dad, "FORM 1", "Day")
    await another(page)
    await student(page, b, typo, "FORM 1", "Day")
    await pick(page, new RegExp(`^Sibling of ${full(a, dad)}`))

    const sheet = page.getByRole("dialog", { name: "One name, or two?" })
    await expect(sheet).toContainText(dad.join(" "))
    await expect(sheet).toContainText(typo.join(" "))
    await pick(page, new RegExp(`The right name is ${dad.join(" ")}$`), sheet)
    await expect(page.getByText("Saved as one name. They are siblings, and the 10% sibling discount applies.")).toBeVisible()
    await expect(page.getByText(/typing mistake fixed, same father, 10% applies/)).toBeVisible()
  })

  test("different fathers' names send a Sibling request, which waits for the Admissions Manager", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    const [one, two] = [father(), father()]
    const [a, b] = [word("BAKARI"), word("LATIFA")]
    await student(page, a, one, "FORM 1", "Day")
    await another(page)
    await student(page, b, two, "FORM 1", "Day")
    await pick(page, new RegExp(`^Sibling of ${full(a, one)}`))

    const sheet = page.getByRole("dialog", { name: "The fathers’ names don’t match" })
    await sheet.getByRole("textbox", { name: "Note for the Admissions Manager" }).fill("Both birth certificates show the same mother.")
    await sheet.getByRole("button", { name: "Request the discount" }).click()
    await go(page, "No, go to custodians").click()
    // Their mother: the father can't be the custodian of both.
    const step = open(page)
    await step.getByRole("textbox", { name: "Custodian’s mobile number" }).fill(phone())
    // The name boxes unfold once the number is checked against families on file.
    await expect(step.locator(".kit-rv[data-open]").getByRole("textbox", { name: "First name" })).toBeVisible()
    await step.getByRole("textbox", { name: "First name" }).fill("mwajuma")
    await step.getByRole("textbox", { name: "Middle name" }).fill("said")
    await step.getByRole("textbox", { name: "Last name" }).fill("kombo")
    await pick(page, "Mother")
    await go(page, "Continue").click()
    await pick(page, /^Someone else/)
    await open(page).getByRole("textbox", { name: "Full name of the person who brought the students" }).fill("rehema said")
    await go(page, "Continue").click()
    await go(page, /NO CODE/).click()
    await expect(open(page).getByRole("table")).toContainText("10% requested · waits for the Manager")
    await go(page, "Looks right").click()
    await go(page, "Register 2 students").click()

    await expect(page.getByRole("heading", { name: "2 students registered" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("1 discount request waits for the Admissions Manager. Remind the family to bring proof.")).toBeVisible()
    expect(await siblingResult(full(b, two))).toMatchObject({ rel: "Mother", brought: "REHEMA SAID", result: "none" })
  })

  test("Yes to a child on file that waits on a Sibling request asks about the father its family counts by, and saves as a request", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    const [one, two] = [father(), father()]
    const [a, b, c] = [word("BAKARI"), word("LATIFA"), word("CHAUSIKU")]
    const mum = [word("MWAJUMA"), word("SAID"), word("KOMBO")]
    const number = phone()

    // On file: B waits on a Sibling request in A's family, which counts by A's father.
    await student(page, a, one, "FORM 1", "Day")
    await another(page)
    await student(page, b, two, "FORM 1", "Day")
    await pick(page, new RegExp(`^Sibling of ${full(a, one)}`))
    await page.getByRole("dialog", { name: "The fathers’ names don’t match" }).getByRole("button", { name: "Request the discount" }).click()
    await go(page, "No, go to custodians").click()
    const first = open(page)
    await first.getByRole("textbox", { name: "Custodian’s mobile number" }).fill(number)
    await expect(first.locator(".kit-rv[data-open]").getByRole("textbox", { name: "First name" })).toBeVisible()
    await first.getByRole("textbox", { name: "First name" }).fill(mum[0])
    await first.getByRole("textbox", { name: "Middle name" }).fill(mum[1])
    await first.getByRole("textbox", { name: "Last name" }).fill(mum[2])
    await pick(page, "Mother")
    await go(page, "Continue").click()
    await pick(page, new RegExp(`^${mum.join(" ")}`))
    await finish(page, 2)
    await expect(page.getByRole("heading", { name: "2 students registered" })).toBeVisible({ timeout: 15_000 })

    // A new child with B's father's name, under the same mother.
    await page.getByRole("button", { name: "Register another family" }).click()
    await student(page, c, two, "FORM 1", "Day")
    await go(page, "No, go to custodians").click()
    const step = open(page)
    await step.getByRole("textbox", { name: "Custodian’s mobile number" }).fill(number)
    await expect(step.getByText(`This number is on file for ${mum.join(" ")}`)).toBeVisible()
    await pick(page, "Same person", step)
    await pick(page, "Mother")
    await go(page, "Continue").click()

    await expect(page.getByRole("heading", { name: `${c} and ${b} have the same father’s name. Are they siblings?` })).toBeVisible()
    await pick(page, new RegExp(`^Yes, sibling of ${full(b, two)}`))
    // B's own name is the same, but B does not count yet: the save compares with A's father.
    const sheet = page.getByRole("dialog", { name: "The fathers’ names don’t match" })
    await expect(sheet).toContainText(one.join(" "))
    await expect(sheet).toContainText(two.join(" "))
    await sheet.getByRole("button", { name: "Request the discount" }).click()
    await expect(page.getByText(/different fathers’ names, discount requested/)).toBeVisible()
    await pick(page, new RegExp(`^${mum.join(" ")}`))
    await go(page, /NO CODE/).click()
    const fees = open(page).getByRole("table")
    await expect(fees.getByRole("row", { name: new RegExp(full(c, two)) })).toContainText("10% requested · waits for the Manager")
    await expect(fees.getByRole("row", { name: new RegExp(full(b, two)) })).toContainText("Fee kept")
    await go(page, "Looks right").click()
    await go(page, "Register 1 student").click()

    await expect(page.getByRole("heading", { name: "1 student registered" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("1 discount request waits for the Admissions Manager. Remind the family to bring proof.")).toBeVisible()
    expect(await siblingResult(full(c, two))).toMatchObject({ rel: "Mother", result: "none" })
  })

  test("a failed save keeps the answers; registering again names the student already on file", async ({ page, allowConsoleError }) => {
    allowConsoleError(/^console\.error: Failed to load resource: net::ERR_FAILED \(http:\/\/[^)]+\/staff\/check-in\/new\)$/, "this test drops the save")
    await signIn(page, ADMISSIONS)
    await start(page)
    const dad = father()
    const a = word("AMANI")
    const number = phone()
    await student(page, a, dad, "FORM 1", "Day")
    await go(page, "No, go to custodians").click()
    await fatherCustodian(page, number)
    await pick(page, new RegExp(`^${dad.join(" ")}`))
    await go(page, /NO CODE/).click()
    await go(page, "Looks right").click()

    // The save never comes back.
    await page.route("**/staff/check-in/new", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()))
    await go(page, "Register 1 student").click()
    await expect(open(page).getByRole("alert")).toContainText("Nothing was saved. Check your connection and press the button again.")
    await page.unroute("**/staff/check-in/new")

    // The tab kept the answers.
    await page.reload()
    await expect(page.getByText(full(a, dad)).first()).toBeVisible()
    await go(page, "Register 1 student").click()
    await expect(page.getByRole("heading", { name: "1 student registered" })).toBeVisible({ timeout: 15_000 })

    // The same student and number again: refused, and nothing new is made.
    await page.getByRole("button", { name: "Register another family" }).click()
    await student(page, a, dad, "FORM 1", "Day")
    await go(page, "No, go to custodians").click()
    const step = open(page)
    await step.getByRole("switch", { name: "The father is the custodian" }).click()
    await step.getByRole("textbox", { name: "Custodian’s mobile number" }).fill(number)
    await expect(step.getByText(`This number is on file for ${dad.join(" ")}`)).toBeVisible()
    await pick(page, "Same person", step)
    await go(page, "Continue").click()
    // The child on file has the same father's name; it is the same child, so Not a sibling.
    await pick(page, /^Not a sibling/)
    await pick(page, new RegExp(`^${dad.join(" ")}`))
    await finish(page, 1)
    await expect(open(page).getByRole("alert")).toContainText(`${full(a, dad)} is already registered, with Admission Number ADMSN-`)
  })

  test("a child on file with the same father's name is asked about, and Yes links them; a fee check that fails is tried again", async ({ page, allowConsoleError }) => {
    allowConsoleError(/^console\.error: Failed to load resource: net::ERR_FAILED \(http:\/\/[^)]+\/staff\/check-in\/new\)$/, "this test drops the fee check")
    await signIn(page, ADMISSIONS)
    const dad = father()
    const number = phone()
    const [first, later] = [word("SALMA"), word("NEEMA")]

    await start(page)
    await student(page, first, dad, { tab: "Primary", name: "STD 4" }, "Day")
    await go(page, "No, go to custodians").click()
    await fatherCustodian(page, number)
    await pick(page, new RegExp(`^${dad.join(" ")}`))
    await go(page, /NO CODE/).click()
    await go(page, "Looks right").click()
    await go(page, "Register 1 student").click()
    await expect(page.getByRole("heading", { name: "1 student registered" })).toBeVisible({ timeout: 15_000 })

    await page.getByRole("button", { name: "Register another family" }).click()
    await student(page, later, dad, "FORM 1", "Day")
    await go(page, "No, go to custodians").click()
    const step = open(page)
    await step.getByRole("switch", { name: "The father is the custodian" }).click()
    await step.getByRole("textbox", { name: "Custodian’s mobile number" }).fill(number)
    await expect(step.getByText(`This number is on file for ${dad.join(" ")}`)).toBeVisible()
    await pick(page, "Same person", step)
    await go(page, "Continue").click()

    await expect(page.getByRole("heading", { name: `${later} and ${first} have the same father’s name. Are they siblings?` })).toBeVisible()
    // The read of the sibling's fee never comes back.
    await page.route("**/staff/check-in/new", (route) => (route.request().method() === "POST" ? route.abort() : route.continue()))
    await pick(page, new RegExp(`^Yes, sibling of ${full(first, dad)}`))
    await pick(page, new RegExp(`^${dad.join(" ")}`))
    await go(page, /NO CODE/).click()
    // No fees to accept on a guess: only the way to check them again.
    await expect(open(page).getByRole("alert")).toHaveText("The fees could not be checked. Try again.")
    await expect(go(page, "Looks right")).toHaveCount(0)
    await page.unroute("**/staff/check-in/new")
    await go(page, "Try again").click()
    await expect(open(page).getByRole("table")).toContainText(full(first, dad))
    await go(page, "Looks right").click()
    await go(page, "Register 1 student").click()
    await expect(page.getByRole("heading", { name: "1 student registered" })).toBeVisible({ timeout: 15_000 })
    // The dearer FORM 1 student pays full; the sibling on file gets the 10%.
    expect(await siblingResult(full(later, dad))).toMatchObject({ result: "full" })
    expect(await siblingResult(full(first, dad))).toMatchObject({ result: "ten" })
  })
})

test.describe("answers that depend on others", () => {
  test.describe.configure({ timeout: 120_000 })

  test("a student linked to one who waits on a Sibling request is compared with the family's own father", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    const [juma, omari] = [father(), father()]
    const [a, b, c] = [word("AMANI"), word("BAKARI"), word("CHAUSIKU")]
    await student(page, a, juma, "FORM 1", "Day")
    await another(page)
    await student(page, b, omari, "FORM 1", "Day")
    await pick(page, new RegExp(`^Sibling of ${full(a, juma)}`))
    await page.getByRole("dialog", { name: "The fathers’ names don’t match" }).getByRole("button", { name: "Request the discount" }).click()
    await another(page)
    await student(page, c, omari, "FORM 1", "Day")
    // The same father as B, but B's group counts by A's father: a request again, never a match.
    await pick(page, new RegExp(`^Yes, sibling of ${full(b, omari)}`))
    const sheet = page.getByRole("dialog", { name: "The fathers’ names don’t match" })
    await expect(sheet).toContainText(juma.join(" "))
    await expect(sheet).toContainText(omari.join(" "))
  })

  test("a new first custodian asks again who \"the same person as before\" is", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    const [one, two] = [father(), father()]
    const [a, b] = [word("AMANI"), word("BAKARI")]
    await student(page, a, one, "FORM 1", "Day")
    await another(page)
    await student(page, b, two, "FORM 1", "Day")
    await pick(page, /^Not a sibling/)
    await go(page, "No, go to custodians").click()
    await fatherCustodian(page, phone())
    await pick(page, new RegExp(`^${one.join(" ")}`))
    await pick(page, "Uncle")
    await go(page, "Continue").click()
    await expect(page.getByRole("heading", { name: new RegExp(`^Who brought`) })).toBeVisible()

    // The first custodian becomes someone else: B's answer named the old one, so B is asked again.
    await page.getByRole("button", { name: new RegExp(`^Change Custodian of ${a}$`) }).click()
    const step = open(page)
    await step.getByRole("switch", { name: "The father is the custodian" }).click()
    await step.getByRole("textbox", { name: "Custodian’s mobile number" }).fill(phone())
    await expect(step.locator(".kit-rv[data-open]").getByRole("textbox", { name: "First name" })).toBeVisible()
    await step.getByRole("textbox", { name: "First name" }).fill("mwajuma")
    await step.getByRole("textbox", { name: "Middle name" }).fill("said")
    await step.getByRole("textbox", { name: "Last name" }).fill("kombo")
    await pick(page, "Mother")
    await go(page, "Continue").click()
    await expect(open(page).getByRole("heading", { name: `Who is the custodian of ${b}?` })).toBeVisible()
    await expect(open(page).getByRole("radio", { name: /^MWAJUMA SAID KOMBO/ })).toBeAttached()
  })
})

test.describe("starting over", () => {
  test("an empty form has nothing to clear; with answers it asks first", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    await page.getByRole("button", { name: "Start over" }).click()
    await expect(page.getByText("Nothing to clear yet. The form is empty.")).toBeVisible()

    const a = word("AMANI")
    await student(page, a, father(), "FORM 1", "Day")
    // Back replaces Start over from the second question.
    await expect(page.getByRole("button", { name: "Start over" })).toBeHidden()
    await page.getByRole("button", { name: new RegExp(`^Change Full name, ${a}`) }).click()
    await page.getByRole("button", { name: "Start over" }).click()
    const sheet = page.getByRole("dialog", { name: "Start over?" })
    await sheet.getByRole("button", { name: "Yes, clear the form" }).click()
    await expect(page.getByText("The form has started over.")).toBeVisible()
    await expect(page.getByText(a)).toHaveCount(0)
  })
})

test.describe("who sees what", () => {
  test("an Accountant gets no Register students on Home, and cannot open the form", async ({ page }) => {
    await signIn(page, ACCOUNTANT)
    await expect(page.getByRole("heading", { name: "Home", level: 1 })).toBeVisible()
    await expect(page.getByRole("link", { name: "Register students" })).toHaveCount(0)
    await page.goto("/staff/check-in/new")
    await expect(page.getByRole("heading", { name: "Not available to your role" })).toBeVisible()
  })

  test("Home goes back to Home", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await start(page)
    await page.getByRole("link", { name: "Home", exact: true }).first().click()
    await expect(page).toHaveURL(/\/staff$/)
  })
})
