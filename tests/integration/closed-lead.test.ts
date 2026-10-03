import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  confirmFamilyMatch,
  correctVisitDate,
  createLead,
  getLead,
  recordVisit,
  rejectFamilyMatch,
  separateFromFamily,
  updateGuardianContact,
  updateLeadDetails,
  type CreateLeadInput,
  type Lead,
  type NewContact,
  type NewStudent,
} from "@/lib/services/leads"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER } from "../support/fixtures"

// A closed lead is read-only (#96), against local Supabase. The seeded
// ADMSN-90005 is Archived and ADMSN-90006 Declined; tests that change a lead
// or a contact make their own, with invented names and numbers.

const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function contact(overrides: Partial<NewContact> = {}): NewContact {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  const phone = `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  return { fullName: `Parent ${randomUUID().slice(0, 6)}`, relationship: "Mother", phone, ...overrides }
}

function student(): NewStudent {
  return { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" }
}

async function created(result: Awaited<ReturnType<typeof createLead>>) {
  if (!result.ok) throw new Error(`setup failed: ${JSON.stringify(result.error)}`)
  return result.data.leadId
}

async function read(id: string): Promise<Lead> {
  const lead = await getLead(await signedIn(ADMISSIONS), id)
  if (!lead.ok) throw new Error("the lead could not be read")
  return lead.data
}

async function walkIn(guardian: CreateLeadInput["guardian"]): Promise<Lead> {
  const id = await created(
    await createLead(await signedIn(ADMISSIONS), { guardian, student: student(), start: { kind: "walk-in", visitDate: today } }),
  )
  return read(id)
}

async function close(id: string, state: "Declined" | "Inactive" | "Archived") {
  // A Declined lead carries its reason (#97).
  const change = state === "Declined" ? "status = 'Declined', declined_reason = 'School decision'" : `closure = '${state}'`
  await asSystem((sql) => sql.query(`update public.leads set ${change} where id = $1`, [id]))
}

// What `sql` raises for `query`, or null, inside a savepoint so the
// transaction carries on.
async function raised(sql: import("pg").Client, query: string, params: unknown[] = []): Promise<string | null> {
  await sql.query("savepoint attempt")
  try {
    await sql.query(query, params)
    await sql.query("release savepoint attempt")
    return null
  } catch (error) {
    await sql.query("rollback to savepoint attempt")
    return (error as Error).message
  }
}

describe("the database keeps a closed lead as it is", () => {
  test("an update to a closed lead is refused as lead_closed, whoever runs it", async () => {
    const answers = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      return {
        archived: await raised(sql, "update public.leads set class_name = 'STD 1' where id = $1", [ARCHIVED]),
        declined: await raised(sql, "update public.leads set student_name = 'Changed' where id = $1", [DECLINED]),
      }
    })
    expect(answers).toEqual({ archived: "lead_closed", declined: "lead_closed" })
  })

  test("a direct update from a staff session leaves a closed lead as it was", async () => {
    const before = await read(ARCHIVED)
    for (const person of [ADMISSIONS, MANAGER]) {
      const staff = await signedIn(person)
      await staff.from("leads").update({ class_name: "STD 1", closure: null }).eq("id", ARCHIVED)
    }
    await secretClient().from("leads").update({ class_name: "STD 1", closure: null }).eq("id", ARCHIVED)
    expect(await read(ARCHIVED)).toEqual(before)
  })

  test("the lifecycle override lets closing, reopening and payment recomputes change a closed lead", async () => {
    const answers = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const out: Record<string, string | null> = {}
      for (const path of ["close", "reopen", "payment_recompute"]) {
        await sql.query("savepoint each")
        await sql.query("select public.set_lead_lifecycle_override($1)", [path])
        out[path] = await raised(sql, "update public.leads set closure = 'Archived' where id = $1", [ARCHIVED])
        await sql.query("rollback to savepoint each")
      }
      out.unknown = await raised(sql, "select public.set_lead_lifecycle_override('anything')")
      return out
    })
    expect(answers).toEqual({ close: null, reopen: null, payment_recompute: null, unknown: "invalid" })
  })

  test("no signed-in caller, the secret key or anon may set the override", async () => {
    for (const client of [await signedIn(ADMISSIONS), await signedIn(MANAGER), secretClient(), anonClient()]) {
      const { error } = await client.rpc("set_lead_lifecycle_override", { path: "reopen" })
      expect(error?.code).toBe("42501")
    }
  })

  test("the override lasts only for the transaction that set it", async () => {
    const answers = await asSystem(async (sql) => {
      await sql.query("select public.set_lead_lifecycle_override('reopen')")
      await sql.query("commit")
      await sql.query("begin")
      await sql.query("select public.set_audit_actor('system')")
      return raised(sql, "update public.leads set class_name = 'STD 1' where id = $1", [ARCHIVED])
    })
    expect(answers).toBe("lead_closed")
  })

  test("closing an open lead is not itself refused", async () => {
    const lead = await walkIn({ contact: contact() })
    await close(lead.id, "Inactive")
    expect((await read(lead.id)).closure).toBe("Inactive")
  })
})

describe("every slice 2 write refuses the seeded closed leads", () => {
  test("details, Visit date, Record visit and the Family writes all come back refused, and nothing changes", async () => {
    const staff = await signedIn(MANAGER)
    for (const id of [ARCHIVED, DECLINED]) {
      const before = await read(id)
      expect(await updateLeadDetails(staff, id, { className: "STD 1" })).toEqual({ ok: false, error: { kind: "closed" } })
      expect(await correctVisitDate(staff, id, today)).toEqual({ ok: false, error: { kind: "closed" } })
      // Only an Applied lead has a visit to record; these are Visited and Declined.
      expect(await recordVisit(staff, id, today)).toEqual({ ok: false, error: { kind: "not-applied" } })
      expect((await confirmFamilyMatch(staff, id)).ok).toBe(false)
      expect((await rejectFamilyMatch(staff, id)).ok).toBe(false)
      expect((await separateFromFamily(staff, id)).ok).toBe(false)
      expect(await read(id)).toEqual(before)
    }
  })

  test("an Applied lead with a closure mark can't have its visit recorded", async () => {
    const id = await created(
      await createLead(secretClient(), { guardian: { contact: contact() }, student: student(), start: { kind: "admission-form" } }),
    )
    await close(id, "Archived")
    expect(await recordVisit(await signedIn(ADMISSIONS), id, today)).toEqual({ ok: false, error: { kind: "closed" } })
    expect(await read(id)).toMatchObject({ status: "Applied", visitDate: null })
  })
})

describe("a parent/guardian contact shared by closed and open children", () => {
  test("stays editable while an open sibling holds it, and the change reaches the closed child too", async () => {
    const open = await walkIn({ contact: contact() })
    const closed = await walkIn({ contactId: open.contact.id })
    await close(closed.id, "Declined")

    expect(
      await updateGuardianContact(await signedIn(ADMISSIONS), open.contact.id, { fullName: "Corrected Parent" }, [
        open.id,
        closed.id,
      ]),
    ).toEqual({ ok: true, data: null })
    expect((await read(open.id)).contact.fullName).toBe("Corrected Parent")
    expect((await read(closed.id)).contact.fullName).toBe("Corrected Parent")
  })

  test("is refused once every child on it is closed", async () => {
    const first = await walkIn({ contact: contact() })
    const second = await walkIn({ contactId: first.contact.id })
    await close(first.id, "Archived")
    await close(second.id, "Inactive")

    expect(await updateGuardianContact(await signedIn(ADMISSIONS), first.contact.id, { fullName: "Changed" })).toEqual({
      ok: false,
      error: { kind: "closed" },
    })
    expect((await read(first.id)).contact).toEqual(first.contact)
  })

  test("the seeded closed leads' own contacts are refused", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const id of [ARCHIVED, DECLINED]) {
      const lead = await read(id)
      expect(await updateGuardianContact(staff, lead.contact.id, { fullName: "Changed" })).toEqual({
        ok: false,
        error: { kind: "closed" },
      })
    }
  })
})

describe("the Family around a closed child", () => {
  test("an open sibling may leave a Family that keeps a closed child, but the closed child may not", async () => {
    const open = await walkIn({ contact: contact() })
    const closed = await walkIn({ contactId: open.contact.id })
    await close(closed.id, "Archived")
    const staff = await signedIn(ADMISSIONS)

    expect(await separateFromFamily(staff, closed.id)).toEqual({ ok: false, error: { kind: "closed" } })
    expect(await separateFromFamily(staff, open.id)).toEqual({ ok: true, data: null })
    expect((await read(closed.id)).contact.id).toBe(open.contact.id)
    expect((await read(open.id)).contact.id).not.toBe(open.contact.id)
  })

  test("an open child may join a Family that includes a closed child", async () => {
    const parent = contact()
    const known = await walkIn({ contact: parent })
    const closedSibling = await walkIn({ contactId: known.contact.id })
    await close(closedSibling.id, "Declined")

    // The Admission form sends a child with the same parent's number.
    const applied = await created(
      await createLead(secretClient(), {
        guardian: { contact: { ...parent, fullName: "Typed On The Form" } },
        student: student(),
        start: { kind: "admission-form" },
      }),
    )
    expect(await confirmFamilyMatch(await signedIn(ADMISSIONS), applied)).toEqual({ ok: true, data: null })
    expect((await read(applied)).contact.id).toBe(known.contact.id)
  })
})
