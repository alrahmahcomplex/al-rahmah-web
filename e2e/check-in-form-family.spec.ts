import { randomInt, randomUUID } from "node:crypto"

import { type Page } from "@playwright/test"
import { expect, test } from "./staff-test"

import { asSystem, inRolledBackTransaction } from "../tests/support/db"
import { ADMISSIONS } from "../tests/support/fixtures"
import { signInOnce } from "./log-in"

// Check-in of an Admission form family (#309, prototype v38): Home finds the
// family by its Admission Number, check-in asks only what the form did not,
// and one save records the visit. Every run sends its own made-up form.

const letters = (n: number) => Array.from({ length: n }, () => String.fromCharCode(65 + randomInt(0, 26))).join("")
const word = (start: string) => `${start}${letters(4)}`
const phone = () => `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`

type Child = { first: string; father: [string, string, string]; className: string; gender: "Boy" | "Girl" | null }
const studentName = (c: Child) => `${c.first} ${c.father[0]} ${c.father[2]}`

/** One Admission form, as the form saves it: the parent, each child's lead, and the submission that created them. */
async function sentForm(children: Child[]) {
  const contactId = randomUUID()
  const parent = `${word("SAIDA")} ${word("OMARI")} ${word("HASSAN")}`
  const parentPhone = phone()
  const ids = children.map(() => randomUUID())
  const year = await inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ year: number }>(
      "select min(enrollment_year)::int as year from public.fee_schedules where enrollment_year >= extract(year from public.tanzania_today())::int",
    )
    if (rows[0].year === null) throw new Error("no Fee schedule for the coming years")
    return rows[0].year
  })
  const numbers = await asSystem(async (sql) => {
    await sql.query(
      "insert into public.guardian_contacts (id, full_name, phone, origin) values ($1, $2, public.normalize_phone($3), 'admission_form')",
      [contactId, parent, parentPhone],
    )
    const taken: string[] = []
    for (const [i, c] of children.entries()) {
      const { rows } = await sql.query<{ admission_number: string }>(
        `insert into public.leads (id, admission_number, student_name, father_full_name, father_full_name_source, gender, class_name,
                                   enrollment_year, day_or_boarding, status, guardian_contact_id, custodian_relationship)
         select $1, free.number, $2, $3, 'entered', $4, $5, $6, 'Day', 'Applied', $7, 'Mother'
         from (select 'ADMSN-' || lpad(n::text, 5, '0') as number from generate_series(0, 99999) n
               where not exists (select 1 from public.leads l where l.admission_number = 'ADMSN-' || lpad(n::text, 5, '0'))
               order by random() limit 1) free
         returning admission_number`,
        [ids[i], studentName(c), c.father.join(" "), c.gender, c.className, year, contactId],
      )
      taken.push(rows[0].admission_number)
    }
    const outcomes = Object.fromEntries(ids.map((id, i) => [String(i), { result: "created", lead_id: id, admission_number: taken[i] }]))
    await sql.query(
      "insert into public.admission_submissions (submission_key, payload_hash, child_count, contact_id, outcomes) values ($1, repeat('a', 64), $2, $3, $4)",
      [randomUUID(), children.length, contactId, JSON.stringify(outcomes)],
    )
    return taken
  })
  return { ids, numbers, parent, surname: children[0].father[2] }
}

async function leadAfter(id: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query(
      `select l.status, l.visit_date is not null as visited, l.custodian_relationship as rel, l.custodian_relationship_description as rel_desc,
              l.brought_by_name as brought, l.previous_school_not_known as school_unknown, l.gender,
              (select m.group_id from public.sibling_group_members m where m.lead_id = l.id and not m.legacy) as group_id
         from public.leads l where l.id = $1`,
      [id],
    )
    return rows[0] as { status: string; visited: boolean; rel: string; rel_desc: string | null; brought: string | null; school_unknown: boolean; gender: string | null; group_id: string | null }
  })
}

const open = (page: Page) => page.locator(".gf-step.gf-open")
const go = (page: Page, name: string | RegExp) => open(page).getByRole("button", { name, exact: typeof name === "string" })
const pick = (page: Page, name: string | RegExp) =>
  open(page).locator("label").filter({ has: page.getByRole("radio", { name, exact: typeof name === "string" }) }).click()

async function findOnHome(page: Page, number: string) {
  await page.goto("/staff")
  const bar = page.getByRole("search", { name: "Check in a family" })
  await bar.getByLabel("Admission Number").fill(number)
  await bar.getByRole("button", { name: "Find the family" }).click()
}

test.describe("checking in an Admission form family", () => {
  test.describe.configure({ timeout: 120_000 })

  test("two siblings and a cousin: only the missing answers, the cousin with its own custodian, a previous school Not known yet", async ({ page }) => {
    const dad: Child["father"] = [word("ALI"), word("OMARI"), word("HASSAN")]
    const yusuf: Child = { first: word("YUSUF"), father: dad, className: "STD 6", gender: "Boy" }
    // The form had no Boy or girl answer for her: it is asked.
    const mariam: Child = { first: word("MARIAM"), father: dad, className: "STD 1", gender: null }
    const zawadi: Child = { first: word("ZAWADI"), father: [word("RASHIDI"), word("KOMBO"), word("SAID")], className: "KG 2", gender: "Girl" }
    const form = await sentForm([yusuf, mariam, zawadi])

    await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
    await findOnHome(page, form.numbers[0])
    await expect(page).toHaveURL(new RegExp(`/staff/check-in/${form.ids[0]}$`))
    const surname = form.surname[0] + form.surname.slice(1).toLowerCase()
    await expect(page.getByRole("heading", { name: `Check in the ${surname} family`, level: 1 })).toBeVisible()
    await expect(page.getByText(`Admission Number ${form.numbers[0]}, sent from the Admission form on`)).toBeVisible()

    // What the form gave shows filled; the class can't be changed here.
    await expect(page.getByText(`Full name · from the Admission form`).first()).toBeVisible()
    await expect(page.getByRole("button", { name: new RegExp(`^Change Class`) })).toHaveCount(0)

    // Yusuf, STD 6: only the previous school is asked.
    await expect(open(page).getByRole("heading", { name: `Which school is ${yusuf.first} coming from?` })).toBeVisible()
    await go(page, "Not known yet").click()
    // Mariam: Boy or girl, by her first name, then whether she is Yusuf's sibling.
    await expect(open(page).getByRole("heading", { name: `Is ${mariam.first} a boy or a girl?` })).toBeVisible()
    await pick(page, "Girl")
    await pick(page, new RegExp(`^Yes, sibling of ${studentName(yusuf)}`))
    // Zawadi, the cousin: another father.
    await expect(open(page).getByRole("heading", { name: `Is ${zawadi.first} a sibling of another student here?` })).toBeVisible()
    await pick(page, /^Not a sibling/)

    // The form's parent is offered for the siblings, with the form's relationship.
    await expect(open(page).getByRole("heading", { name: `Who is the custodian of ${yusuf.first} and ${mariam.first}?` })).toBeVisible()
    await expect(open(page).getByRole("textbox", { name: "First name" }).last()).toHaveValue(form.parent.split(" ")[0])
    await go(page, "Continue").click()
    // The cousin's custodian: the same person, as her aunt.
    await expect(open(page).getByRole("heading", { name: `Who is the custodian of ${zawadi.first}?` })).toBeVisible()
    await pick(page, /^Someone else\s+Mother, guardian/)
    await pick(page, new RegExp(`^${form.parent}`))
    await pick(page, "Aunt")
    await go(page, "Continue").click()

    // Today's visit.
    await expect(open(page).getByRole("heading", { name: "Who brought the students today?" })).toBeVisible()
    await pick(page, new RegExp(`^${form.parent}`))
    await expect(open(page).getByRole("heading", { name: "Check the fees and the sibling discount" })).toBeVisible()
    await go(page, "Looks right").click()
    await expect(open(page).getByRole("heading", { name: "Record today’s visit for 3 students?" })).toBeVisible()
    await go(page, "Record the visit").click()

    await expect(page.getByRole("heading", { name: "Visit recorded" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText("The students are now Visited.", { exact: true })).toBeVisible()
    for (const number of form.numbers) await expect(page.getByText(number, { exact: true })).toBeVisible()
    await expect(page.getByText("1 previous school is saved as Not known yet.", { exact: false })).toBeVisible()

    const [y, m, z] = await Promise.all(form.ids.map(leadAfter))
    expect(y).toMatchObject({ status: "Visited", visited: true, rel: "Mother", brought: form.parent, school_unknown: true })
    expect(m).toMatchObject({ status: "Visited", rel: "Mother", gender: "Girl" })
    expect(z).toMatchObject({ status: "Visited", rel: "Other", rel_desc: "Aunt" })
    // The siblings share a group; the cousin is in none.
    expect(y.group_id).not.toBeNull()
    expect(m.group_id).toBe(y.group_id)
    expect(z.group_id).toBeNull()

    // Checked in, the number opens the record again.
    await findOnHome(page, form.numbers[1])
    await expect(page).toHaveURL(new RegExp(`/staff/applicants/${form.ids[1]}$`))
  })

  test("an old Outside Tanzania school with no country opens prefilled for the country, and single-student finish opens View full record", async ({ page }) => {
    const dad: Child["father"] = [word("ALI"), word("OMARI"), word("HASSAN")]
    const yusuf: Child = { first: word("YUSUF"), father: dad, className: "STD 6", gender: "Boy" }
    const form = await sentForm([yusuf])
    await asSystem((sql) =>
      sql.query(
        "update public.leads set previous_school_name = 'OLD SCHOOL ABROAD', previous_school_type = 'private', previous_school_region = 'Outside Tanzania' where id = $1",
        [form.ids[0]],
      ),
    )

    await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
    await findOnHome(page, form.numbers[0])
    await expect(page).toHaveURL(new RegExp(`/staff/check-in/${form.ids[0]}$`))
    await expect(open(page).getByRole("heading", { name: `Which school is ${yusuf.first} coming from?` })).toBeVisible()
    await expect(open(page).getByText(/no country saved yet/i)).toBeVisible()
    await expect(open(page).getByRole("textbox", { name: "School name" })).toHaveValue("OLD SCHOOL ABROAD")
    await open(page).getByRole("combobox", { name: "Country" }).fill("uga")
    await open(page).getByRole("combobox", { name: "Country" }).press("Enter")
    await go(page, "Continue").click()
    // Custodian prefilled from Admission form -> Someone else (Mother).
    await go(page, "Continue").click()
    await pick(page, new RegExp(`^${form.parent}`))
    await go(page, "Looks right").click()
    await go(page, "Record the visit").click()

    await expect(page.getByRole("heading", { name: "Visit recorded" })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole("link", { name: "View full record" })).toHaveAttribute("href", `/staff/applicants/${form.ids[0]}`)
    await page.getByRole("button", { name: "Register for interview" }).click()
    const sheet = page.getByRole("dialog", { name: "Register for interview" })
    // With one student, only that student's button shows (no Register all).
    await expect(sheet.getByRole("button", { name: "Register all for interview" })).toHaveCount(0)
    await expect(sheet.getByRole("button", { name: "Register for interview" })).toBeVisible()
    await sheet.getByRole("button", { name: "Register for interview" }).click()
    await expect(sheet.getByText("Registered for interview")).toBeVisible({ timeout: 10_000 })

    const country = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ previous_school_country: string | null }>(
        "select previous_school_country from public.leads where id = $1",
        [form.ids[0]],
      )
      return rows[0].previous_school_country
    })
    expect(country).toBe("Uganda")
  })

  test("the Applicants sheet offers check-in for a family still waiting for its visit", async ({ page }) => {
    const child: Child = { first: word("NEEMA"), father: [word("JUMA"), word("SALIM"), word("MRISHO")], className: "KG 1", gender: "Girl" }
    const form = await sentForm([child])

    await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
    await page.goto(`/staff/applicants?q=${form.numbers[0]}`)
    await page.getByRole("table", { name: "Applicants" }).locator("tbody tr").first().click()
    const sheet = page.getByRole("dialog", { name: studentName(child) })
    await expect(sheet.getByText("Sent from the Admission form. Check-in fills in the missing answers.")).toBeVisible()
    await sheet.getByRole("link", { name: "Check in this family" }).click()
    await expect(page).toHaveURL(new RegExp(`/staff/check-in/${form.ids[0]}$`))
    await expect(page.getByRole("heading", { name: /^Check in the .+ family$/, level: 1 })).toBeVisible()
  })

  test("a lead registered at the desk opens its record, not check-in", async ({ page }) => {
    await signInOnce(page, ADMISSIONS.email, ADMISSIONS.password)
    // A seeded lead no Admission form created.
    await page.goto("/staff/check-in/1ead0000-0000-4000-8000-000000000047")
    await expect(page).toHaveURL(/\/staff\/applicants\/1ead0000-0000-4000-8000-000000000047$/)
  })
})
