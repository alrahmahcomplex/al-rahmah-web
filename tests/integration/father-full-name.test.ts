import { randomInt, randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { admissionYears } from "@/lib/admission-form"
import { submitAdmissionForm } from "@/lib/services/admission-form"
import { createLead, updateLeadDetails, type NewContact } from "@/lib/services/leads"
import { tanzaniaToday } from "@/lib/school-calendar"

import { asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// The father's full name on each lead (#299): the three-level name check,
// the four-part split, the trigger that derives it on insert and on a name
// change, and the migration's backfill. As the database owner, since no API
// role may call these functions, and through the leads and Admission form
// services for the insert and correction paths.

const MIGRATION = "supabase/migrations/20261210100100_father_full_name.sql"
const [, nextYear] = admissionYears()
const today = tanzaniaToday()

async function owner<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

async function match(a: string | null, b: string | null): Promise<string | null> {
  const [row] = await owner<{ m: string | null }>("select public.father_name_match($1, $2) as m", [a, b])
  return row.m
}

function phone() {
  // A leading 05 keeps it clear of the seeded 700 000 numbers and of the
  // other test files' numbers.
  return `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

function parent(): NewContact {
  return { fullName: `Father Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone: phone() }
}

// A unique word made only of letters, so a name keeps its word count.
function word(): string {
  return Array.from({ length: 8 }, () => String.fromCharCode(97 + randomInt(0, 26))).join("")
}

async function walkIn(fullName: string): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: parent() },
    student: { fullName, className: "STD 2", enrollmentYear: nextYear, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

type FatherRow = { father_full_name: string | null; father_full_name_source: string | null }

async function father(leadId: string): Promise<FatherRow> {
  const [row] = await owner<FatherRow>(
    "select father_full_name, father_full_name_source::text from public.leads where id = $1",
    [leadId],
  )
  return row
}

async function setFather(leadId: string, name: string | null, source: string | null) {
  await asSystem((sql) =>
    sql.query("update public.leads set father_full_name = $2, father_full_name_source = $3 where id = $1", [leadId, name, source]),
  )
}

describe("the three-level father's-name check", () => {
  test.each([
    // The spec's examples (S5).
    ["Mohamed", "Mohammed", "close"],
    ["Abdallah", "Abdalla", "close"],
    ["Ali", "Abu", "different"],
    ["Mohamed", "Muhammad", "different"],
    ["Mohamed Ali", "mohamed  ali.", "same"],
    ["Ali Hassan Mohamed", "Ali Hassan", "close"],
    ["Juma Ali", "Juma", "different"],
    // Case, spacing and the five removed marks make no difference.
    ["  ABDUL-RAHMAN   O'Brien, ", "abdulrahman obrien", "same"],
    ["Hassan Ali", "Hassan Ali’", "same"],
    // A swap of two neighbouring letters counts 1, not 2.
    ["Mohamed", "Mohaemd", "close"],
    // Distance is the total over the words, at most 2.
    ["Mohamed Hassan", "Mohammed Hasan", "close"],
    ["Mohamed Hassan Juma", "Mohammed Hasan Jumaa", "different"],
    // A word of 4 letters or fewer takes at most 1.
    ["Juma", "Jumaa", "close"],
    ["Ali", "Alibu", "different"],
    ["Omar", "Amir", "different"],
    ["Ali Hassan", "Ali Hussein", "different"],
    // Words are compared in order.
    ["Hassan Ali", "Ali Hassan", "different"],
    // One extra final word needs the shared words equal and at least 2 of them.
    ["Ali Hassan", "Ali Hassan Mohamed", "close"],
    ["Ali Hassan Mohamed Juma", "Ali Hassan Mohamed", "close"],
    ["Ali Hassan Mohamed", "Ali Hasan", "different"],
    ["Hassan Ali Mohamed", "Ali Mohamed", "different"],
    ["Ali Hassan Mohamed Juma", "Ali Hassan", "different"],
  ])("%s against %s is %s", async (a, b, expected) => {
    expect(await match(a, b)).toBe(expected)
    expect(await match(b, a)).toBe(expected)
  })

  test("a missing name is neither a match nor a mismatch", async () => {
    expect(await match(null, "Hassan Ali")).toBeNull()
    expect(await match("Hassan Ali", "  ")).toBeNull()
    expect(await match(".-", "Hassan")).toBeNull()
  })

  test("word distance is the optimal string alignment distance", async () => {
    const rows = await owner<{ d: number }>(
      `select public.word_edit_distance(a, b) as d
       from (values ('ca', 'abc'), ('kitten', 'sitting'), ('', 'abc'), ('abc', 'abc'), ('ab', 'ba')) v(a, b)`,
    )
    // ca to abc is 3 under the alignment rule: no letter is edited twice.
    expect(rows.map((row) => row.d)).toEqual([3, 3, 3, 0, 1])
  })

  test("no API role may call the functions", async () => {
    const rows = await owner<{ fn: string; anon: boolean; authed: boolean }>(
      `select p.proname as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authed
       from pg_proc p
       where p.pronamespace = 'public'::regnamespace
         and p.proname in ('father_name_match', 'normalize_father_name', 'word_edit_distance', 'split_student_name',
                           'derive_father_full_name', 'student_name_words', 'derive_lead_father_full_name')
       order by 1`,
    )
    expect(rows).toHaveLength(7)
    expect(rows.filter((row) => row.anon || row.authed)).toEqual([])
  })
})

describe("splitting a stored name into the four check-in fields", () => {
  test.each([
    ["Amina Hassan Juma", ["Amina", "Hassan", "Juma", null]],
    ["  Amina  Hassan Juma Mwinyi   Bakari ", ["Amina", "Hassan", "Juma", "Mwinyi Bakari"]],
    ["Amina Hassan", ["Amina", "Hassan", null, null]],
    ["Amina", ["Amina", null, null, null]],
    ["\tAmina Hassan\n", ["Amina", "Hassan", null, null]],
    ["\r\n Amina\tHassan  Juma \t", ["Amina", "Hassan", "Juma", null]],
  ])("%s", async (name, parts) => {
    const [row] = await owner<Record<string, string | null>>("select * from public.split_student_name($1)", [name])
    expect([row.first_name, row.fathers_name, row.last_name, row.surname]).toEqual(parts)
  })
})

describe("deriving the father's name", () => {
  test("a staff walk-in derives it from the words after the first", async () => {
    const [a, b, c] = [word(), word(), word()]
    const lead = await walkIn(`Amina ${a}  ${b} ${c}`)
    expect(await father(lead)).toEqual({ father_full_name: `${a} ${b} ${c}`, father_full_name_source: "derived" })
  })

  test("a two-word name derives its second word", async () => {
    const a = word()
    const lead = await walkIn(`Amina ${a}`)
    expect(await father(lead)).toEqual({ father_full_name: a, father_full_name_source: "derived" })
  })

  test("a one-word name leaves it empty", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const lead = await insertLead(sql, await newContact(sql), "Amina", null, null)
      expect(lead).toMatchObject({ father_full_name: null, father_full_name_source: null })
    })
  })

  test("tabs and line breaks at either end are not words", async () => {
    const rows = await owner<{ d: string | null }>(
      "select public.derive_father_full_name(n) as d from unnest($1::text[]) with ordinality u(n, i) order by i",
      [["\tJuma Ali", "Juma Ali\n", "\r\nJuma\tHassan  Ali\t", " \t "]],
    )
    expect(rows.map((row) => row.d)).toEqual(["Ali", "Ali", "Hassan Ali", null])
  })

  test("an Admission form child derives it", async () => {
    const [a, b] = [word(), word()]
    const fullName = `Zuhura ${a} ${b}`
    const result = await submitAdmissionForm(secretClient(), {
      submissionKey: randomUUID(),
      parent: { fullName: "Form Parent", relationship: "Mother", phone: phone() },
      children: [{ fullName, className: "KG 2", enrollmentYear: nextYear, dayOrBoarding: "Day" }],
    })
    if (!result.ok) throw new Error(`form failed: ${JSON.stringify(result.error)}`)
    const [row] = await owner<FatherRow>(
      "select father_full_name, father_full_name_source::text from public.leads where student_name = $1",
      [fullName],
    )
    expect(row).toEqual({ father_full_name: `${a} ${b}`, father_full_name_source: "derived" })
  })

  test("the trigger runs before every insert, whatever path creates the lead", async () => {
    const [row] = await owner<{ def: string }>(
      `select pg_get_triggerdef(t.oid) as def from pg_trigger t
       where t.tgrelid = 'public.leads'::regclass and t.tgname = 'derive_lead_father_full_name'`,
    )
    expect(row.def).toMatch(/BEFORE INSERT OR UPDATE OF student_name, father_full_name, father_full_name_source ON public\.leads FOR EACH ROW EXECUTE/)
  })

  test("an insert that brings the father's name keeps it, and one without a source is refused", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const contact = await newContact(sql)
      const kept = await insertLead(sql, contact, "Amina Hassan Juma", "Hassan Juma Bakari", "edited")
      expect(kept).toMatchObject({ father_full_name: "Hassan Juma Bakari", father_full_name_source: "edited" })
      await sql.query("savepoint s")
      await expect(insertLead(sql, contact, "Amina Hassan Juma", "Hassan Juma", null)).rejects.toThrow(/leads_father_full_name_has_source/)
      await sql.query("rollback to savepoint s")
      await expect(insertLead(sql, contact, "Amina Hassan Juma", null, "edited")).rejects.toThrow(/leads_father_full_name_has_source/)
    })
  })
})

describe("re-deriving on a student name correction", () => {
  test("a derived name follows the new student name", async () => {
    const lead = await walkIn(`Amina ${word()} ${word()}`)
    const [a, b] = [word(), word()]
    expect(await updateLeadDetails(await signedIn(ADMISSIONS), lead, { fullName: `Amina ${a} ${b}` })).toEqual({ ok: true, data: null })
    expect(await father(lead)).toEqual({ father_full_name: `${a} ${b}`, father_full_name_source: "derived" })
  })

  test("a backfilled name follows it and stays backfilled", async () => {
    const lead = await walkIn(`Amina ${word()} ${word()}`)
    await setFather(lead, "Old Backfill", "backfilled")
    const [a, b] = [word(), word()]
    expect((await updateLeadDetails(await signedIn(ADMISSIONS), lead, { fullName: `Amina ${a} ${b}` })).ok).toBe(true)
    expect(await father(lead)).toEqual({ father_full_name: `${a} ${b}`, father_full_name_source: "backfilled" })
  })

  test("a new name of two words derives its second word", async () => {
    const lead = await walkIn(`Amina ${word()} ${word()}`)
    const a = word()
    expect((await updateLeadDetails(await signedIn(ADMISSIONS), lead, { fullName: `Amina ${a}` })).ok).toBe(true)
    expect(await father(lead)).toEqual({ father_full_name: a, father_full_name_source: "derived" })
  })

  test("a new name of one word empties a derived name, and it stays empty after", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const lead = await insertLead(sql, await newContact(sql), "Amina Hassan Juma", null, null)
      const rename = async (name: string) =>
        (
          await sql.query<FatherRow>(
            "update public.leads set student_name = $2 where id = $1 returning father_full_name, father_full_name_source::text",
            [lead.id, name],
          )
        ).rows[0]
      expect(await rename("Amina")).toEqual({ father_full_name: null, father_full_name_source: null })
      // Only a derived or backfilled name moves with the student's name (#299).
      expect(await rename("Amina Bakari Ali")).toEqual({ father_full_name: null, father_full_name_source: null })
    })
  })

  test("an update that sets the father's name with the student's name keeps what it set", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const lead = await insertLead(sql, await newContact(sql), "Amina Hassan Juma", null, null)
      const { rows } = await sql.query<FatherRow>(
        `update public.leads set student_name = 'Amina Bakari Ali', father_full_name = 'Bakari Ali Mussa',
                father_full_name_source = 'edited'
         where id = $1 returning father_full_name, father_full_name_source::text`,
        [lead.id],
      )
      expect(rows[0]).toEqual({ father_full_name: "Bakari Ali Mussa", father_full_name_source: "edited" })
    })
  })

  test.each(["edited", "typo_confirmed"])("a %s name never moves with the student name", async (source) => {
    const lead = await walkIn(`Amina ${word()} ${word()}`)
    await setFather(lead, "Staff Entered Name", source)
    expect((await updateLeadDetails(await signedIn(ADMISSIONS), lead, { fullName: `Amina ${word()} ${word()}` })).ok).toBe(true)
    expect((await updateLeadDetails(await signedIn(ADMISSIONS), lead, { fullName: `Amina` })).ok).toBe(true)
    expect(await father(lead)).toEqual({ father_full_name: "Staff Entered Name", father_full_name_source: source })
  })

  test("a change of class alone leaves it as it is", async () => {
    const lead = await walkIn(`Amina ${word()} ${word()}`)
    const before = await father(lead)
    expect((await updateLeadDetails(await signedIn(ADMISSIONS), lead, { className: "STD 3" })).ok).toBe(true)
    expect(await father(lead)).toEqual(before)
  })

  test("a correction refused as a duplicate changes nothing", async () => {
    const contact = parent()
    const staff = await signedIn(ADMISSIONS)
    const sibling = `Amina ${word()} ${word()}`
    const first = await createLead(staff, {
      guardian: { contact },
      student: { fullName: sibling, className: "STD 2", enrollmentYear: nextYear, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: today },
    })
    if (!first.ok) throw new Error(JSON.stringify(first.error))
    // A brother or sister on the same contact, renamed to the first child's name.
    const second = await createLead(staff, {
      guardian: { contactId: await contactIdOf(first.data.leadId) },
      student: { fullName: `Baraka ${word()} ${word()}`, className: "STD 2", enrollmentYear: nextYear, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: today },
    })
    if (!second.ok) throw new Error(JSON.stringify(second.error))
    const before = await father(second.data.leadId)

    const refused = await updateLeadDetails(staff, second.data.leadId, { fullName: sibling })
    expect(refused.ok).toBe(false)
    expect(await father(second.data.leadId)).toEqual(before)
  })
})

describe("the migration's backfill", () => {
  // The migration's backfill: its one do block (snapshot, update and fee
  // check), as written in the file.
  function backfillSection(): string {
    const text = readFileSync(MIGRATION, "utf8").replace(/\r\n/g, "\n")
    const start = text.indexOf("do $$\ndeclare\n    moved uuid;")
    if (start < 0) throw new Error(`${MIGRATION}: no backfill block`)
    return text.slice(start)
  }

  const SNAPSHOT_TAKEN = "    -- (snapshot taken)\n"

  test("fills names of three or more words as backfilled, closed leads too, and moves no fee", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const contact = await newContact(sql)
      // Leads from before the column existed: no father's name at all.
      await sql.query("alter table public.leads disable trigger derive_lead_father_full_name")
      const three = await insertLead(sql, contact, "Amina Hassan Juma", null, null)
      const four = await insertLead(sql, contact, "Baraka  Hassan Juma Bakari", null, null)
      const two = await insertLead(sql, contact, "Chausiku Hassan", null, null)
      const declined = await insertLead(sql, contact, "Dalila Hassan Juma", null, null, "Declined")
      const staffEntered = await insertLead(sql, contact, "Elia Hassan Juma", "Someone Else", "edited")
      await sql.query("alter table public.leads enable trigger derive_lead_father_full_name")

      const feesBefore = await fees(sql, contact)
      await sql.query(backfillSection())

      const rows = await sql.query<{ father_full_name: string | null; father_full_name_source: string | null }>(
        `select father_full_name, father_full_name_source::text
         from public.leads where id = any ($1) order by student_name`,
        [[three, four, two, declined, staffEntered].map((row) => row.id)],
      )
      expect(rows.rows.map(({ father_full_name, father_full_name_source }) => [father_full_name, father_full_name_source])).toEqual([
        ["Hassan Juma", "backfilled"],
        ["Hassan Juma Bakari", "backfilled"],
        [null, null],
        ["Hassan Juma", "backfilled"],
        ["Someone Else", "edited"],
      ])
      expect(await fees(sql, contact)).toEqual(feesBefore)

      // The closed-lead guard is back on.
      await sql.query("savepoint s")
      await expect(sql.query("update public.leads set father_full_name = 'X Y', father_full_name_source = 'edited' where id = $1", [declined.id])).rejects.toThrow(/lead_closed/)
      await sql.query("rollback to savepoint s")

      // Each backfilled lead has an audit entry as the system.
      const audit = await sql.query<{ n: number }>(
        `select count(*)::int as n from public.audit_log
         where lead_id = any ($1) and actor_kind = 'system' and new_values ->> 'father_full_name_source' = 'backfilled'`,
        [[three, four, declined].map((row) => row.id)],
      )
      expect(audit.rows[0].n).toBe(3)
    })
  })

  test("the fee check raises when a lead's fee, discount, status or Seat priority moved", async () => {
    const block = backfillSection()
    expect(block).toContain(SNAPSHOT_TAKEN)
    // As if the backfill had moved the lead's fee: the snapshot says otherwise.
    const tampered = block.replace(
      SNAPSHOT_TAKEN,
      () => "    update father_name_fee_snapshot set fee = fee || '{\"school_fee\": -1}';\n",
    )
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // A lead the backfill would write, so the snapshot holds it.
      await sql.query("alter table public.leads disable trigger derive_lead_father_full_name")
      const lead = await insertLead(sql, await newContact(sql), "Amina Hassan Juma", null, null)
      await sql.query("alter table public.leads enable trigger derive_lead_father_full_name")
      await sql.query("savepoint s")
      await expect(sql.query(tampered)).rejects.toThrow(/father_name_backfill_moved_a_fee/)
      await sql.query("rollback to savepoint s")
      // Nothing the block did stays: the lead is not backfilled, and the guard is on.
      const after = await sql.query<FatherRow>(
        "select father_full_name, father_full_name_source::text from public.leads where id = $1",
        [lead.id],
      )
      expect(after.rows[0]).toEqual({ father_full_name: null, father_full_name_source: null })
      const guard = await sql.query<{ on: string }>(
        "select tgenabled as on from pg_trigger where tgrelid = 'public.leads'::regclass and tgname = 'refuse_closed_lead_change'",
      )
      expect(guard.rows[0].on).toBe("O")
    })
  })
})

// ---------------------------------------------------------------------------
// Owner-side helpers, inside one rolled-back transaction.
// ---------------------------------------------------------------------------

async function newContact(sql: Client): Promise<string> {
  const { rows } = await sql.query<{ id: string }>(
    `insert into public.guardian_contacts (full_name, relationship, phone, origin)
     values ('Backfill Parent', 'Mother', public.normalize_phone($1), 'front_desk') returning id`,
    [phone()],
  )
  return rows[0].id
}

async function insertLead(
  sql: Client,
  contactId: string,
  studentName: string,
  fatherName: string | null,
  source: string | null,
  status = "Visited",
): Promise<FatherRow & { id: string }> {
  const number = await sql.query<{ n: string }>(
    `select 'ADMSN-' || lpad(n::text, 5, '0') as n
     from generate_series(1, 99999) n
     where not exists (select 1 from public.leads l where l.admission_number = 'ADMSN-' || lpad(n::text, 5, '0'))
     order by random() limit 1`,
  )
  const { rows } = await sql.query<FatherRow & { id: string }>(
    `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status,
                               visit_date, guardian_contact_id, father_full_name, father_full_name_source,
                               declined_reason)
     values ($1, $2, 'STD 2', $3, 'Day', $4::public.lead_status, $5, $6, $7, $8::public.father_name_source,
             case when $4 = 'Declined' then 'School decision'::public.declined_reason end)
     returning id, father_full_name, father_full_name_source::text`,
    [number.rows[0].n, studentName, nextYear, status, today, contactId, fatherName, source],
  )
  return rows[0]
}

async function contactIdOf(leadId: string): Promise<string> {
  const [row] = await owner<{ id: string }>("select guardian_contact_id as id from public.leads where id = $1", [leadId])
  return row.id
}

// The fee, discount, status and Seat priority of every lead on one contact.
async function fees(sql: Client, contactId: string) {
  const { rows } = await sql.query(
    `select l.id, l.status, to_jsonb(f) as fee, to_jsonb(s) as seat
     from public.leads l
     cross join lateral public.lead_fee_amounts(l.id) f
     cross join lateral public.lead_seat_priority(l.id) s
     where l.guardian_contact_id = $1
     order by l.id`,
    [contactId],
  )
  return rows
}
