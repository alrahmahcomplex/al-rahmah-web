import { randomInt, randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { tanzaniaToday } from "@/lib/school-calendar"
import { createLead, getLead, type CreateLeadInput, type NewContact, type NewStudent } from "@/lib/services/leads"

import { anonClient, inRolledBackTransaction, secretClient, signedIn } from "./db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "./fixtures"

// The lead module against local Supabase, signed in as each seeded role. Each
// test invents its own names and numbers, so runs never collide with one
// another or with the seeded fixtures (+255 700 000 xxx).

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function nineDigits() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `7${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

function uniqueName(prefix = "Pupil") {
  return `${prefix} ${randomUUID().slice(0, 8)}`
}

function contact(overrides: Partial<NewContact> = {}): NewContact {
  return { fullName: "Test Parent", relationship: "Mother", phone: `0${nineDigits()}`, ...overrides }
}

function student(overrides: Partial<NewStudent> = {}): NewStudent {
  return { fullName: uniqueName(), className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day", ...overrides }
}

function walkIn(input: { contact?: NewContact; student?: NewStudent; visitDate?: string } = {}): CreateLeadInput {
  return {
    guardian: { contact: input.contact ?? contact() },
    student: input.student ?? student(),
    start: { kind: "walk-in", visitDate: input.visitDate ?? today },
  }
}

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

test.describe("creating a lead at the front desk", () => {
  test("creates a Visited lead with its Admission Number and Visit date", async () => {
    const staff = await signedIn(ADMISSIONS)
    const input = walkIn({ visitDate: "2026-01-05" })

    const created = await createLead(staff, input)
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(created.data.admissionNumber).toMatch(/^ADMSN-\d{5}$/)

    const lead = await getLead(staff, created.data.leadId)
    expect(lead.ok && lead.data).toMatchObject({
      admissionNumber: created.data.admissionNumber,
      studentName: input.student.fullName,
      className: "STD 2",
      enrollmentYear: thisYear + 1,
      dayOrBoarding: "Day",
      status: "Visited",
      closure: null,
      visitDate: "2026-01-05",
      returningFamily: false,
    })
  })

  test("Admission Numbers are ADMSN- and five digits, and never repeat", async () => {
    const staff = await signedIn(ADMISSIONS)
    const numbers = new Set<string>()
    for (let i = 0; i < 8; i++) {
      const created = await createLead(staff, walkIn())
      expect(created.ok).toBe(true)
      if (created.ok) numbers.add(created.data.admissionNumber)
    }
    expect(numbers.size).toBe(8)
    for (const number of numbers) expect(number).toMatch(/^ADMSN-\d{5}$/)
  })

  test("an Admissions Manager may register a walk-in too", async () => {
    expect((await createLead(await signedIn(MANAGER), walkIn())).ok).toBe(true)
  })
})

test.describe("phone numbers", () => {
  const NINE = () => nineDigits()

  test("every way families say a number is stored as +255 and nine digits", async () => {
    const staff = await signedIn(ADMISSIONS)
    const cases = [
      (d: string) => `0${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`,
      (d: string) => d,
      (d: string) => `+255 ${d.slice(0, 3)} ${d.slice(3, 6)} ${d.slice(6)}`,
      (d: string) => `255${d}`,
      (d: string) => `(0${d.slice(0, 3)})-${d.slice(3, 6)}.${d.slice(6)}`,
    ]

    for (const say of cases) {
      const digits = NINE()
      const created = await createLead(staff, walkIn({ contact: contact({ phone: say(digits) }) }))
      expect(created.ok, say(digits)).toBe(true)
      if (!created.ok) continue
      const lead = await getLead(staff, created.data.leadId)
      expect(lead.ok && lead.data.contact.phone).toBe(`+255${digits}`)
    }
  })

  test("an international number is kept, and WhatsApp is normalized like the direct phone", async () => {
    const staff = await signedIn(ADMISSIONS)
    const digits = NINE()
    const created = await createLead(
      staff,
      walkIn({ contact: contact({ phone: "+44 20 7946 0958", whatsapp: `0${digits}` }) }),
    )
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const lead = await getLead(staff, created.data.leadId)
    expect(lead.ok && lead.data.contact).toMatchObject({ phone: "+442079460958", whatsapp: `+255${digits}` })
  })

  test("a number that is not a phone number is refused, and nothing is written", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const phone of ["12345", "abc", "+12", "0712 34", "+1234567890123456", ""]) {
      const pupil = student()
      const result = await createLead(staff, walkIn({ contact: contact({ phone }), student: pupil }))
      expect(result, phone).toEqual({ ok: false, error: { kind: "invalid", field: "phone" } })
      expect(await rows("select 1 from public.leads where student_name = $1", [pupil.fullName])).toHaveLength(0)
    }

    const badWhatsapp = await createLead(staff, walkIn({ contact: contact({ whatsapp: "nope" }) }))
    expect(badWhatsapp).toEqual({ ok: false, error: { kind: "invalid", field: "whatsapp" } })
  })
})

test.describe("other details", () => {
  test("names the field a refusal is about", async () => {
    const staff = await signedIn(ADMISSIONS)
    const tomorrow = tanzaniaToday(new Date(Date.now() + 36 * 60 * 60 * 1000))

    const refused = async (input: CreateLeadInput) => {
      const result = await createLead(staff, input)
      return result.ok ? "created" : result.error.kind === "invalid" ? result.error.field : result.error.kind
    }

    expect(await refused(walkIn({ visitDate: tomorrow }))).toBe("visit_date")
    expect(await refused(walkIn({ student: student({ enrollmentYear: thisYear + 3 }) }))).toBe("enrollment_year")
    expect(await refused(walkIn({ student: student({ enrollmentYear: thisYear - 1 }) }))).toBe("enrollment_year")
    expect(await refused(walkIn({ student: student({ fullName: "  " }) }))).toBe("student_name")
    expect(await refused(walkIn({ student: student({ className: "STD 9" as never }) }))).toBe("class_name")
    expect(await refused(walkIn({ contact: contact({ fullName: " " }) }))).toBe("contact_name")
    expect(await refused(walkIn({ contact: contact({ relationship: "Other" }) }))).toBe("relationship_description")
    expect(
      await refused(walkIn({ contact: contact({ relationship: "Other", relationshipDescription: "Neighbour" }) })),
    ).toBe("created")
  })

  test("a Visit date can be earlier than today, and today itself is fine", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect((await createLead(staff, walkIn({ visitDate: today }))).ok).toBe(true)
    expect((await createLead(staff, walkIn({ visitDate: "2026-01-02" }))).ok).toBe(true)
  })
})

test.describe("duplicates", () => {
  test("the same child with the same direct number is refused, showing the existing lead", async () => {
    const staff = await signedIn(ADMISSIONS)
    const input = walkIn()
    const first = await createLead(staff, input)
    expect(first.ok).toBe(true)
    if (!first.ok) return

    const second = await createLead(staff, input)
    expect(second).toEqual({
      ok: false,
      error: {
        kind: "duplicate",
        lead: { id: first.data.leadId, admissionNumber: first.data.admissionNumber, status: "Visited", closure: null },
      },
    })
    expect(await rows("select 1 from public.leads where student_name = $1", [input.student.fullName])).toHaveLength(1)
  })

  test("capitalization and spacing in the name, and a different way of writing the number, still match", async () => {
    const staff = await signedIn(ADMISSIONS)
    const digits = nineDigits()
    const base = uniqueName("Amina Juma")
    const first = await createLead(
      staff,
      walkIn({ contact: contact({ phone: `0${digits}` }), student: student({ fullName: base }) }),
    )
    expect(first.ok).toBe(true)

    const [given, family, tag] = base.split(" ")
    const messy = `  ${given.toUpperCase()}    ${family.toLowerCase()}  ${tag} `
    const second = await createLead(
      staff,
      walkIn({ contact: contact({ phone: `+255 ${digits}` }), student: student({ fullName: messy }) }),
    )
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.error.kind).toBe("duplicate")
  })

  test("the WhatsApp number counts, both ways round", async () => {
    const staff = await signedIn(ADMISSIONS)
    const direct = nineDigits()
    const whatsapp = nineDigits()
    const pupil = student()
    const first = await createLead(
      staff,
      walkIn({ contact: contact({ phone: `0${direct}`, whatsapp: `0${whatsapp}` }), student: pupil }),
    )
    expect(first.ok).toBe(true)

    // The stored WhatsApp number given as the new direct phone.
    const viaWhatsapp = await createLead(staff, walkIn({ contact: contact({ phone: `0${whatsapp}` }), student: pupil }))
    expect(viaWhatsapp.ok === false && viaWhatsapp.error.kind).toBe("duplicate")

    // The stored direct phone given as the new WhatsApp number.
    const asWhatsapp = await createLead(
      staff,
      walkIn({ contact: contact({ phone: `0${nineDigits()}`, whatsapp: `0${direct}` }), student: pupil }),
    )
    expect(asWhatsapp.ok === false && asWhatsapp.error.kind).toBe("duplicate")
  })

  test("a different child, or the same name with another parent's number, is not a duplicate", async () => {
    const staff = await signedIn(ADMISSIONS)
    const parent = contact()
    const pupil = student()
    expect((await createLead(staff, walkIn({ contact: parent, student: pupil }))).ok).toBe(true)

    expect((await createLead(staff, walkIn({ contact: parent, student: student() }))).ok).toBe(true)
    expect((await createLead(staff, walkIn({ contact: contact(), student: pupil }))).ok).toBe(true)
  })

  test("leads that are Applied, Archived or Declined still match, and say so", async () => {
    const staff = await signedIn(ADMISSIONS)
    const against = async (fullName: string, phone: string) => {
      const result = await createLead(staff, walkIn({ contact: contact({ phone }), student: student({ fullName }) }))
      return result.ok ? null : result.error
    }

    expect(await against("zawadi  FIXTURE", "0700 000 101")).toMatchObject({
      kind: "duplicate",
      lead: { admissionNumber: "ADMSN-90001", status: "Applied", closure: null },
    })
    expect(await against("Hamisi Fixture", "+255 700 000 104")).toMatchObject({
      kind: "duplicate",
      lead: { admissionNumber: "ADMSN-90005", status: "Visited", closure: "Archived" },
    })
    expect(await against("Rehema Fixture", "255700000105")).toMatchObject({
      kind: "duplicate",
      lead: { admissionNumber: "ADMSN-90006", status: "Declined", closure: null },
    })
    // A seeded WhatsApp number matches too.
    expect(await against("Salma Fixture", "0700 000 113")).toMatchObject({
      kind: "duplicate",
      lead: { admissionNumber: "ADMSN-90004" },
    })
  })

  test("two people registering the same child at the same moment end with one lead", async () => {
    const [one, two] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])
    const digits = nineDigits()
    const pupil = student()
    const attempt = (client: typeof one, phone: string) =>
      createLead(client, walkIn({ contact: contact({ phone }), student: pupil }))

    const results = await Promise.all([attempt(one, `0${digits}`), attempt(two, `+255${digits}`)])

    expect(results.filter((r) => r.ok)).toHaveLength(1)
    const refused = results.filter((r) => !r.ok)
    expect(refused).toHaveLength(1)
    expect(refused[0].ok === false && refused[0].error.kind).toBe("duplicate")
    expect(await rows("select 1 from public.leads where student_name = $1", [pupil.fullName])).toHaveLength(1)
  })
})

test.describe("Families", () => {
  test("a child added to a known contact shares it and is flagged Returning family", async () => {
    const staff = await signedIn(ADMISSIONS)
    const parent = contact()
    const first = await createLead(staff, walkIn({ contact: parent }))
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const firstLead = await getLead(staff, first.data.leadId)
    if (!firstLead.ok) throw new Error("lead missing")

    const sibling = await createLead(staff, {
      guardian: { contactId: firstLead.data.contact.id },
      student: student(),
      start: { kind: "walk-in", visitDate: today },
    })
    expect(sibling.ok).toBe(true)
    if (!sibling.ok) return

    const siblingLead = await getLead(staff, sibling.data.leadId)
    expect(siblingLead.ok && siblingLead.data).toMatchObject({ returningFamily: true })
    expect(siblingLead.ok && siblingLead.data.contact.id).toBe(firstLead.data.contact.id)
    expect(firstLead.data.returningFamily).toBe(false)
  })
})

test.describe("who may create", () => {
  test("an Accountant is refused, and nothing is written", async () => {
    const pupil = student()
    const result = await createLead(await signedIn(ACCOUNTANT), walkIn({ student: pupil }))
    expect(result).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await rows("select 1 from public.leads where student_name = $1", [pupil.fullName])).toHaveLength(0)
  })

  test("someone signed out is refused", async () => {
    const result = await createLead(anonClient(), walkIn())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.kind).toBe("unavailable")
  })

  test("the secret key cannot start a walk-in", async () => {
    expect(await createLead(secretClient(), walkIn())).toEqual({ ok: false, error: { kind: "forbidden" } })
  })

  test("a staff session cannot start as the Admission form", async () => {
    const result = await createLead(await signedIn(MANAGER), {
      guardian: { contact: contact() },
      student: student(),
      start: { kind: "admission-form" },
    })
    expect(result).toEqual({ ok: false, error: { kind: "forbidden" } })
  })
})

test.describe("the Admission form start", () => {
  test("creates an Applied lead with no Visit date, written as the Admission form", async () => {
    const pupil = student()
    const created = await createLead(secretClient(), {
      guardian: { contact: contact() },
      student: pupil,
      start: { kind: "admission-form" },
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const [lead] = await rows<{ status: string; visit_date: string | null; returning_family_joined: boolean }>(
      "select status, visit_date, returning_family_joined from public.leads where id = $1",
      [created.data.leadId],
    )
    expect(lead).toEqual({ status: "Applied", visit_date: null, returning_family_joined: false })

    const [entry] = await rows<{ actor_kind: string; actor_staff_id: string | null }>(
      "select actor_kind, actor_staff_id from public.audit_log where lead_id = $1 and action = 'insert'",
      [created.data.leadId],
    )
    expect(entry).toEqual({ actor_kind: "public_form", actor_staff_id: null })
  })

  test("a known parent number leaves a pending Family match, and the child is flagged Returning family", async () => {
    const staff = await signedIn(ADMISSIONS)
    const parent = contact()
    const known = await createLead(staff, walkIn({ contact: parent }))
    expect(known.ok).toBe(true)
    if (!known.ok) return

    const applied = await createLead(secretClient(), {
      guardian: { contact: { ...parent, fullName: "Someone Else", phone: parent.phone.replace(/^0/, "+255") } },
      student: student(),
      start: { kind: "admission-form" },
    })
    expect(applied.ok).toBe(true)
    if (!applied.ok) return

    const [row] = await rows<{ joined: boolean; pending: string | null; matched: string }>(
      `select l.returning_family_joined as joined, c.pending_family_match_id as pending, k.guardian_contact_id as matched
       from public.leads l
       join public.guardian_contacts c on c.id = l.guardian_contact_id
       join public.leads k on k.id = $2
       where l.id = $1`,
      [applied.data.leadId, known.data.leadId],
    )
    expect(row.joined).toBe(true)
    expect(row.pending).toBe(row.matched)
  })

  test("the form can share only a contact an earlier child of the form created", async () => {
    const staff = await signedIn(ADMISSIONS)
    const deskLead = await createLead(staff, walkIn())
    if (!deskLead.ok) throw new Error("setup failed")
    const desk = await getLead(staff, deskLead.data.leadId)
    if (!desk.ok) throw new Error("setup failed")

    const forDesk = await createLead(secretClient(), {
      guardian: { contactId: desk.data.contact.id },
      student: student(),
      start: { kind: "admission-form" },
    })
    expect(forDesk).toEqual({ ok: false, error: { kind: "invalid", field: "contact" } })

    const first = await createLead(secretClient(), {
      guardian: { contact: contact() },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!first.ok) throw new Error("setup failed")
    const [{ guardian_contact_id }] = await rows<{ guardian_contact_id: string }>(
      "select guardian_contact_id from public.leads where id = $1",
      [first.data.leadId],
    )
    const second = await createLead(secretClient(), {
      guardian: { contactId: guardian_contact_id },
      student: student(),
      start: { kind: "admission-form" },
    })
    expect(second.ok).toBe(true)
  })
})

test.describe("reading, writing around the module, and deleting", () => {
  test("visitors who are not signed in read no lead and no contact", async () => {
    const anon = anonClient()
    for (const table of ["leads", "guardian_contacts"]) {
      const { data, error } = await anon.from(table).select("*")
      expect(error).toBeNull()
      expect(data).toEqual([])
    }
  })

  test("an Accountant can find and read a lead, and sees its contact", async () => {
    const accountant = await signedIn(ACCOUNTANT)
    const { data } = await accountant.from("leads").select("id").eq("admission_number", "ADMSN-90002")
    expect(data).toHaveLength(1)
    const lead = await getLead(accountant, "1ead0000-0000-4000-8000-000000000002")
    expect(lead.ok && lead.data).toMatchObject({ studentName: "Baraka Fixture", contact: { phone: "+255700000102" } })
  })

  test("a lead that does not exist, or an id that is not one, is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getLead(staff, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await getLead(staff, "not-a-uuid")).toEqual({ ok: false, error: "not-found" })
  })

  test("nobody writes to the tables directly, and nobody deletes", async () => {
    for (const client of [await signedIn(MANAGER), secretClient(), anonClient()]) {
      for (const table of ["leads", "guardian_contacts"]) {
        expect((await client.from(table).insert({})).error).not.toBeNull()
        expect((await client.from(table).update({ id: randomUUID() }).eq("id", randomUUID())).error).not.toBeNull()
        expect((await client.from(table).delete().eq("id", randomUUID())).error).not.toBeNull()
      }
    }

    // Not even the database owner can delete or empty them.
    for (const table of ["leads", "guardian_contacts"]) {
      await expect(rows(`delete from public.${table}`)).rejects.toThrow(/delete_refused/)
      await expect(rows(`truncate public.${table} cascade`)).rejects.toThrow(/delete_refused/)
    }
  })

  test("the Admission Number cannot be changed, and a Visit date cannot be set in the future", async () => {
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.leads set admission_number = 'ADMSN-00000' where admission_number = 'ADMSN-90001'")
      }),
    ).rejects.toThrow(/admission_number_locked/)

    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query(
          "update public.leads set visit_date = public.tanzania_today() + 1 where admission_number = 'ADMSN-90002'",
        )
      }),
    ).rejects.toThrow(/visit_date_in_future/)

    // A lead past Applied must have a Visit date.
    await expect(
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.leads set visit_date = null where admission_number = 'ADMSN-90002'")
      }),
    ).rejects.toThrow(/leads_check/)
  })
})

test.describe("audit history", () => {
  test("a new lead's creation is in the history, by the staff member who made it", async () => {
    const staff = await signedIn(ADMISSIONS)
    const created = await createLead(staff, walkIn())
    if (!created.ok) throw new Error("setup failed")

    const entries = await rows<{ table_name: string; action: string; actor_kind: string; name: string; scope: string }>(
      `select a.table_name, a.action, a.actor_kind, s.full_name as name, a.scope
       from public.audit_log a
       join public.staff_members s on s.id = a.actor_staff_id
       where a.lead_id = $1`,
      [created.data.leadId],
    )
    expect(entries).toEqual([
      { table_name: "leads", action: "insert", actor_kind: "staff", name: ADMISSIONS.name, scope: "lead" },
    ])
  })

  test("the same history is readable by a staff member who may view leads, and by no one else", async () => {
    const created = await createLead(await signedIn(ADMISSIONS), walkIn())
    if (!created.ok) throw new Error("setup failed")

    const viewed = await (await signedIn(ACCOUNTANT)).from("audit_log").select("id").eq("lead_id", created.data.leadId)
    expect(viewed.data).toHaveLength(1)
    const visitor = await anonClient().from("audit_log").select("id").eq("lead_id", created.data.leadId)
    expect(visitor.data).toEqual([])
  })
})
