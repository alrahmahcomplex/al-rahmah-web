import { randomInt, randomUUID } from "node:crypto"

import { expect, test, type Page } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead, getLead } from "@/lib/services/leads"

import { asSystem, secretClient, signedIn } from "../tests/support/db"
import { ACCOUNTANT, ADMISSIONS, type FixtureStaff } from "../tests/support/fixtures"

// Settling an unconfirmed Family match on the lead screen, and seeing
// unconfirmed children in the Family lists.

const thisYear = Number(tanzaniaToday().slice(0, 4))

// The seeded unconfirmed match: Upendo and Furaha Kinship came through the
// Admission form on one contact whose phone matched Khadija Kinship, the
// parent of Tumaini Kinship.
const SEEDED = {
  family: "c0c0c0c0-0000-4000-8000-000000000048",
  form: "c0c0c0c0-0000-4000-8000-000000000049",
  known: { id: "1ead0000-0000-4000-8000-000000000048", name: "Tumaini Kinship" },
  upendo: { id: "1ead0000-0000-4000-8000-000000000049", name: "Upendo Kinship", number: "ADMSN-90049" },
  furaha: { id: "1ead0000-0000-4000-8000-000000000050", name: "Furaha Kinship", number: "ADMSN-90050" },
}

async function signIn(page: Page, person: FixtureStaff) {
  await page.goto("/login")
  await page.getByLabel("Email").fill(person.email)
  await page.getByLabel("Password", { exact: true }).fill(person.password)
  await page.getByRole("button", { name: "Log In" }).click()
  await expect(page).toHaveURL(/\/staff$/)
}

function familyRow(page: Page, name: string) {
  return page.getByRole("table", { name: "Children in this Family" }).getByRole("row", { name: new RegExp(name) })
}

// A Family made at the front desk with one child, and a child the Admission
// form then sent with the same parent's number, of the test's own.
async function unconfirmedMatch() {
  const digits = `7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const parent = `Parent ${randomUUID().slice(0, 6)}`
  const known = `Known ${randomUUID().slice(0, 6)}`
  const applied = `Applied ${randomUUID().slice(0, 6)}`
  const student = { className: "STD 2" as const, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" as const }

  const desk = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: parent, relationship: "Father", phone: `0${digits}` } },
    student: { ...student, fullName: known },
    start: { kind: "walk-in", visitDate: tanzaniaToday() },
  })
  const form = await createLead(secretClient(), {
    guardian: { contact: { fullName: `${parent} Typed`, relationship: "Father", phone: `+255${digits}` } },
    student: { ...student, fullName: applied },
    start: { kind: "admission-form" },
  })
  if (!desk.ok || !form.ok) throw new Error("setup failed")
  return { phone: `0${digits}`, parent, known, applied, appliedId: form.data.leadId, knownId: desk.data.leadId }
}

test.describe("the seeded unconfirmed match", () => {
  // Puts the match back, so the test can run again without a database reset.
  test.beforeEach(async () => {
    await asSystem(async (sql) => {
      await sql.query("update public.guardian_contacts set pending_family_match_id = $2 where id = $1", [
        SEEDED.form,
        SEEDED.family,
      ])
      await sql.query(
        "update public.leads set guardian_contact_id = $1, returning_family_joined = true where id = any ($2)",
        [SEEDED.form, [SEEDED.upendo.id, SEEDED.furaha.id]],
      )
    })
  })

  test("staff confirm it, naming both children it moves, and both join the Family", async ({ page }) => {
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${SEEDED.upendo.id}`)

    const family = page.getByRole("region", { name: "Family" })
    await expect(family.getByText("Unconfirmed Family match")).toBeVisible()
    await expect(family).toContainText("Khadija Kinship")
    await expect(familyRow(page, SEEDED.known.name)).not.toContainText("Unconfirmed")
    await expect(familyRow(page, SEEDED.furaha.name)).toContainText("Unconfirmed")

    await family.getByRole("button", { name: "Confirm match" }).click()
    const confirm = family.getByRole("form", { name: "Confirm" })
    await expect(confirm).toContainText("Confirming moves these 2 children into Khadija Kinship's Family:")
    await expect(confirm.getByRole("listitem")).toHaveText([
      `${SEEDED.upendo.name} ${SEEDED.upendo.number}`,
      `${SEEDED.furaha.name} ${SEEDED.furaha.number}`,
    ])
    await confirm.getByRole("button", { name: "Confirm" }).click()

    await expect(family.getByRole("status")).toHaveText("Match confirmed. 2 children are now in the Family.")
    await expect(family.getByText("Unconfirmed Family match")).toHaveCount(0)
    await expect(familyRow(page, SEEDED.furaha.name)).not.toContainText("Unconfirmed")
    // The lead now shares the Family's parent or guardian.
    const parent = page.getByRole("region", { name: "Parent or guardian" })
    await expect(parent).toContainText("Khadija Kinship")
    await expect(parent).not.toContainText("Khadija A. Kinship")

    // It stays after a reload, and the other child moved too.
    await page.goto(`/staff/leads/${SEEDED.furaha.id}`)
    await expect(page.getByText("Unconfirmed Family match")).toHaveCount(0)
    await expect(familyRow(page, SEEDED.upendo.name)).not.toContainText("Unconfirmed")
    await expect(page.getByText("Returning family", { exact: true })).toBeVisible()
  })
})

test.describe("settling a match of the test's own", () => {
  test("rejecting clears the match and the Returning family badge", async ({ page }) => {
    const match = await unconfirmedMatch()
    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${match.appliedId}`)

    await expect(page.getByText("Returning family", { exact: true })).toBeVisible()
    const family = page.getByRole("region", { name: "Family" })
    await family.getByRole("button", { name: "Reject match" }).click()
    const reject = family.getByRole("form", { name: "Reject" })
    await expect(reject.getByRole("listitem")).toHaveCount(1)
    await reject.getByRole("button", { name: "Reject" }).click()

    await expect(family.getByRole("status")).toHaveText("Match rejected. The children are no longer linked to that Family.")
    await expect(family.getByText("Unconfirmed Family match")).toHaveCount(0)
    await expect(family).toContainText("No other children are in this Family.")
    await expect(page.getByText("Returning family", { exact: true })).toHaveCount(0)
  })

  test("the known Family's lead and check-in list the form's child as unconfirmed", async ({ page }) => {
    const match = await unconfirmedMatch()
    await signIn(page, ADMISSIONS)

    await page.goto(`/staff/leads/${match.knownId}`)
    await expect(familyRow(page, match.applied)).toContainText("Unconfirmed")
    // A match is settled from the child the form sent, not from here.
    await expect(page.getByRole("button", { name: "Confirm match" })).toHaveCount(0)

    await page.goto("/staff/check-in/new")
    await page.getByLabel("Full name").fill(match.parent)
    await page.getByLabel("Relationship to the student").selectOption("Father")
    await page.getByLabel("Phone", { exact: true }).fill(match.phone)
    await page.getByRole("button", { name: "Continue" }).click()
    // One parent on file, not the form's copy as a second one.
    await expect(page.getByRole("button", { name: "Same person", exact: true })).toHaveCount(1)
    await page.getByRole("group", { name: match.parent }).getByRole("button", { name: "Same person" }).click()
    await expect(page.getByRole("row", { name: new RegExp(match.applied) })).toContainText("Unconfirmed")
    await expect(page.getByRole("row", { name: new RegExp(match.known) })).not.toContainText("Unconfirmed")
  })

  test("separating a sibling gives them their own parent or guardian and takes the badge away", async ({ page }) => {
    const match = await unconfirmedMatch()
    const staff = await signedIn(ADMISSIONS)
    const known = await getLead(staff, match.knownId)
    if (!known.ok) throw new Error("setup failed")
    const sibling = `Sibling ${randomUUID().slice(0, 6)}`
    const joined = await createLead(staff, {
      guardian: { contactId: known.data.contact.id },
      student: { fullName: sibling, className: "KG 1", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: tanzaniaToday() },
    })
    if (!joined.ok) throw new Error("setup failed")

    await signIn(page, ADMISSIONS)
    await page.goto(`/staff/leads/${joined.data.leadId}`)
    await expect(page.getByText("Returning family", { exact: true })).toBeVisible()
    const family = page.getByRole("region", { name: "Family" })
    await family.getByRole("button", { name: "Separate from this Family" }).click()
    const separate = family.getByRole("form", { name: "Separate" })
    await expect(separate.getByRole("listitem")).toHaveText([new RegExp(match.known)])
    await separate.getByRole("button", { name: "Separate" }).click()

    await expect(family.getByRole("status")).toHaveText(
      "Separated from the Family. This lead now has a parent or guardian contact of its own.",
    )
    await expect(family).toContainText("No other children are in this Family.")
    await expect(page.getByText("Returning family", { exact: true })).toHaveCount(0)
    await expect(page.getByRole("region", { name: "Parent or guardian" })).toContainText(match.parent)
  })

  test("the Accountant sees the Family and the match, with nothing to settle", async ({ page }) => {
    const match = await unconfirmedMatch()
    await signIn(page, ACCOUNTANT)
    await page.goto(`/staff/leads/${match.appliedId}`)

    const family = page.getByRole("region", { name: "Family" })
    await expect(family.getByText("Unconfirmed Family match")).toBeVisible()
    await expect(familyRow(page, match.known)).toBeVisible()
    for (const name of ["Confirm match", "Reject match", "Separate from this Family"]) {
      await expect(page.getByRole("button", { name })).toHaveCount(0)
    }
  })
})
