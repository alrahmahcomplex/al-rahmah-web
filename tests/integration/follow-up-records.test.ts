import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  changeFollowUpDate,
  getLeadFollowUps,
  listContactStaff,
  recordFollowUp,
  scheduleFollowUp,
  type ContactRecord,
} from "@/lib/services/follow-ups"
import { createLead } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER, RETIRED_ROLE, SECOND_MANAGER } from "../support/fixtures"

// Recording a contact on a lead (#91) through the follow-up module, against
// local Supabase. Each test makes its own leads; the seeded ones are only
// read or refused.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 2's seeded Declined lead, and slice 7's seeded contacts.
const DECLINED = "1ead0000-0000-4000-8000-000000000006"
const BARAKA = "1ead0000-0000-4000-8000-000000000002"
const BARAKA_CALL = "f0120000-0000-4000-8000-000000000002"
const NEEMA = "1ead0000-0000-4000-8000-000000000003"
const NEEMA_WHATSAPP = "f0120000-0000-4000-8000-000000000003"

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Contact Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function scheduled(leadId: string, days = 1): Promise<string> {
  const result = await scheduleFollowUp(await signedIn(ADMISSIONS), leadId, { dueOn: addDays(today, days) })
  if (!result.ok) throw new Error(`schedule failed: ${JSON.stringify(result.error)}`)
  return result.data.followUpId
}

function contact(followUpId: string | null, overrides: Partial<ContactRecord> = {}): ContactRecord {
  return {
    followUpId,
    comment: "Spoke with the father about the interview date.",
    method: "Phone call",
    contactedBy: ADMISSIONS.id,
    contactedAt: new Date(Date.now() - 60_000).toISOString(),
    outcome: { kind: "next_date", dueOn: addDays(today, 7), note: "Confirm the interview." },
    ...overrides,
  }
}

async function recordsOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) => (await sql.query("select id from public.follow_up_records where lead_id = $1", [leadId])).rows,
  )
}

describe("recording a contact", () => {
  test("closes the open follow-up and opens the next, and lists the record", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)
    const contactedAt = new Date(Date.now() - 30 * 60_000).toISOString()

    const recorded = await recordFollowUp(staff, lead, contact(planned, { method: "WhatsApp", contactedAt, contactedBy: MANAGER.id }))
    expect(recorded).toEqual({ ok: true, data: { recordId: expect.any(String) } })

    const read = await getLeadFollowUps(staff, lead)
    if (!read.ok) throw new Error("read failed")
    expect(read.data.open).toMatchObject({ dueOn: addDays(today, 7), note: "Confirm the interview.", replacesId: null })
    expect(read.data.earlier).toEqual([expect.objectContaining({ id: planned })])
    expect(read.data.records).toEqual([
      {
        id: recorded.ok && recorded.data.recordId,
        kind: "contact",
        followUpId: planned,
        outcome: "next_date",
        cause: null,
        comment: "Spoke with the father about the interview date.",
        method: "WhatsApp",
        contactedBy: { id: MANAGER.id, name: MANAGER.name },
        contactedAt: expect.any(String),
        enteredAt: expect.any(String),
        nextFollowUpId: read.data.open?.id,
      },
    ])
    expect(Date.parse(read.data.records[0].contactedAt!)).toBe(Date.parse(contactedAt))
  })

  test("an unplanned contact is recorded on a lead with no open follow-up", async () => {
    const lead = await newLead()
    const staff = await signedIn(MANAGER)

    expect(await recordFollowUp(staff, lead, contact(null, { comment: "  The mother phoned in about uniforms.  " }))).toMatchObject({
      ok: true,
    })
    const read = await getLeadFollowUps(staff, lead)
    expect(read).toMatchObject({
      ok: true,
      data: {
        open: { dueOn: addDays(today, 7) },
        records: [{ followUpId: null, comment: "The mother phoned in about uniforms.", outcome: "next_date" }],
      },
    })
  })

  test("lists records newest first by when the contact happened", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    await recordFollowUp(staff, lead, contact(null, { comment: "The later call." }))
    const open = await getLeadFollowUps(staff, lead)
    if (!open.ok || !open.data.open) throw new Error("no open follow-up")
    // Entered second, but made three days earlier.
    await recordFollowUp(
      staff,
      lead,
      contact(open.data.open.id, { comment: "The earlier call.", contactedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
    )

    const read = await getLeadFollowUps(staff, lead)
    expect(read.ok && read.data.records.map((r) => r.comment)).toEqual(["The later call.", "The earlier call."])
  })

  test("needs a next date after today and at most 365 days ahead", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)

    for (const days of [0, -1, 366]) {
      expect(
        await recordFollowUp(staff, lead, contact(planned, { outcome: { kind: "next_date", dueOn: addDays(today, days) } })),
        String(days),
      ).toEqual({ ok: false, error: { kind: "invalid", field: "next_due_on" } })
    }
    expect(await recordFollowUp(staff, lead, contact(planned, { outcome: { kind: "next_date", dueOn: "not-a-date" } }))).toEqual({
      ok: false,
      error: { kind: "invalid", field: "next_due_on" },
    })
    expect(
      await recordFollowUp(staff, lead, contact(planned, { outcome: { kind: "next_date", dueOn: addDays(today, 2), note: "x".repeat(501) } })),
    ).toEqual({ ok: false, error: { kind: "invalid", field: "next_note" } })
    // A Visited lead can't end without a next date.
    expect(await recordFollowUp(staff, lead, contact(planned, { outcome: { kind: "lead_enrolled" } }))).toEqual({
      ok: false,
      error: { kind: "invalid", field: "outcome" },
    })
    expect(await recordsOf(lead)).toEqual([])

    expect(
      await recordFollowUp(staff, lead, contact(planned, { outcome: { kind: "next_date", dueOn: addDays(today, 365) } })),
    ).toMatchObject({ ok: true })
  })

  test("an Enrolled lead may end with no next date, and may still plan one", async () => {
    const [lead, other] = await Promise.all([newLead(), newLead()])
    const planned = await scheduled(lead)
    await asSystem((sql) => sql.query("update public.leads set status = 'Enrolled' where id = any($1)", [[lead, other]]))
    const staff = await signedIn(ADMISSIONS)

    expect(await recordFollowUp(staff, lead, contact(planned, { outcome: { kind: "lead_enrolled" } }))).toMatchObject({ ok: true })
    expect(await getLeadFollowUps(staff, lead)).toMatchObject({
      ok: true,
      data: { open: null, records: [{ outcome: "lead_enrolled", nextFollowUpId: null }] },
    })

    expect(await recordFollowUp(staff, other, contact(null))).toMatchObject({ ok: true })
    expect(await getLeadFollowUps(staff, other)).toMatchObject({ ok: true, data: { open: { dueOn: addDays(today, 7) } } })
  })

  test("the decline outcome is refused until the decline flow is built", async () => {
    const lead = await newLead()
    const staff = await signedIn(MANAGER)
    const declined = await recordFollowUp(staff, lead, {
      ...contact(null),
      outcome: { kind: "lead_declined" } as unknown as ContactRecord["outcome"],
    })
    expect(declined).toEqual({ ok: false, error: { kind: "invalid", field: "outcome" } })
  })

  test("a contact time later than now is refused; an old one is kept", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)

    expect(
      await recordFollowUp(staff, lead, contact(null, { contactedAt: new Date(Date.now() + 10 * 60_000).toISOString() })),
    ).toEqual({ ok: false, error: { kind: "invalid", field: "contacted_at" } })
    expect(
      await recordFollowUp(staff, lead, contact(null, { contactedAt: new Date(Date.now() - 40 * 86_400_000).toISOString() })),
    ).toMatchObject({ ok: true })
  })

  test("the comment is 3 to 2,000 characters, and the method one of the four", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)

    for (const comment of ["", "  ab ", "x".repeat(2001)]) {
      expect(await recordFollowUp(staff, lead, contact(null, { comment })), comment.slice(0, 10)).toEqual({
        ok: false,
        error: { kind: "invalid", field: "comment" },
      })
    }
    for (const method of ["Email", "phone call", ""]) {
      expect(await recordFollowUp(staff, lead, contact(null, { method })), method).toEqual({
        ok: false,
        error: { kind: "invalid", field: "method" },
      })
    }
    expect(await recordsOf(lead)).toEqual([])
    for (const method of ["Phone call", "WhatsApp", "SMS", "In-person"]) {
      const fresh = await newLead()
      expect(await recordFollowUp(staff, fresh, contact(null, { method, comment: "x".repeat(2000) })), method).toMatchObject({
        ok: true,
      })
    }
  })

  test("names an active colleague who records contacts, never a deactivated one or a role without the permission", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)

    for (const person of [DEACTIVATED, RETIRED_ROLE, ACCOUNTANT]) {
      expect(await recordFollowUp(staff, lead, contact(null, { contactedBy: person.id })), person.email).toEqual({
        ok: false,
        error: { kind: "invalid", field: "contacted_by" },
      })
    }
    expect(await recordFollowUp(staff, lead, contact(null, { contactedBy: randomUUID() }))).toEqual({
      ok: false,
      error: { kind: "invalid", field: "contacted_by" },
    })
    expect(await recordFollowUp(staff, lead, contact(null, { contactedBy: SECOND_MANAGER.id }))).toMatchObject({ ok: true })
  })

  test("a follow-up opened, changed or recorded since the form loaded is a conflict", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    // The form loaded with nothing planned, then a colleague scheduled one.
    const planned = await scheduled(lead)
    expect(await recordFollowUp(staff, lead, contact(null))).toEqual({ ok: false, error: { kind: "conflict" } })

    // The form loaded on a date a colleague then changed.
    const moved = await changeFollowUpDate(staff, planned, { dueOn: addDays(today, 4), reason: "Parent travelling." })
    if (!moved.ok) throw new Error("change failed")
    expect(await recordFollowUp(staff, lead, contact(planned))).toEqual({ ok: false, error: { kind: "conflict" } })
    expect(await recordsOf(lead)).toEqual([])

    // A follow-up from another lead is not this lead's open one.
    const other = await newLead()
    expect(await recordFollowUp(staff, other, contact(moved.data.followUpId))).toEqual({ ok: false, error: { kind: "conflict" } })
  })

  test("two staff recording the same follow-up at once end with one record and one conflict", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      recordFollowUp(one, lead, contact(planned, { comment: "First call." })),
      recordFollowUp(other, lead, contact(planned, { comment: "Second call.", contactedBy: MANAGER.id })),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { kind: "conflict" } }])
    expect(await recordsOf(lead)).toHaveLength(1)
    const read = await getLeadFollowUps(one, lead)
    expect(read.ok && read.data.earlier.length).toBe(1)
  })

  test("two unplanned contacts at once also end with one", async () => {
    const lead = await newLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])
    const results = await Promise.all([recordFollowUp(one, lead, contact(null)), recordFollowUp(other, lead, contact(null))])
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { kind: "conflict" } }])
    expect(await recordsOf(lead)).toHaveLength(1)
  })

  test("refuses a closed lead as read-only, and a lead that does not exist as not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await recordFollowUp(staff, DECLINED, contact(null))).toEqual({ ok: false, error: { kind: "read-only" } })
    expect(await recordFollowUp(staff, randomUUID(), contact(null))).toEqual({ ok: false, error: { kind: "not-found" } })
    expect(await recordFollowUp(staff, "not-a-uuid", contact(null))).toEqual({ ok: false, error: { kind: "not-found" } })
    expect(await recordsOf(DECLINED)).toEqual([])
  })
})

describe("who may record a contact", () => {
  test("the Accountant, deactivated staff and a role without follow_ups.record are refused", async () => {
    const lead = await newLead()
    const viewer = await createThrowawayStaff(["leads.view", "leads.edit"])
    for (const person of [ACCOUNTANT, DEACTIVATED, viewer]) {
      expect(await recordFollowUp(await signedIn(person), lead, contact(null)), person.email).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      })
    }
    expect(await recordsOf(lead)).toEqual([])
  })

  test("nobody outside a staff session may record, the secret key included", async () => {
    const lead = await newLead()
    for (const client of [anonClient(), secretClient()]) {
      expect(await recordFollowUp(client, lead, contact(null))).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await recordsOf(lead)).toEqual([])
  })

  test("records are never updated or deleted, even by the database owner", async () => {
    await expect(
      asSystem((sql) => sql.query("update public.follow_up_records set comment = 'Changed.' where id = $1", [BARAKA_CALL])),
    ).rejects.toThrow("update_refused")
    await expect(
      inRolledBackTransaction((sql) => sql.query("delete from public.follow_up_records where id = $1", [BARAKA_CALL])),
    ).rejects.toThrow("delete_refused")
    const staff = await signedIn(MANAGER)
    const update = await staff.from("follow_up_records").update({ comment: "Changed." }).eq("id", BARAKA_CALL).select("id")
    expect(update.error?.code).toBe("42501")
    const del = await staff.from("follow_up_records").delete().eq("id", BARAKA_CALL).select("id")
    expect(del.error?.code).toBe("42501")
    const insert = await staff.from("follow_up_records").insert({ lead_id: BARAKA, kind: "contact" }).select("id")
    expect(insert.error?.code).toBe("42501")
  })

  test("the database refuses a record missing its kind's fields or carrying another kind's", async () => {
    const queries = [
      // A contact with no comment.
      `insert into public.follow_up_records (lead_id, kind, outcome, method, contacted_by, contacted_at)
       values ($1, 'contact', 'lead_enrolled', 'SMS', '${ADMISSIONS.id}', now())`,
      // A next_date outcome with no next follow-up.
      `insert into public.follow_up_records (lead_id, kind, outcome, comment, method, contacted_by, contacted_at)
       values ($1, 'contact', 'next_date', 'Called.', 'SMS', '${ADMISSIONS.id}', now())`,
      // A closing with a comment.
      `insert into public.follow_up_records (lead_id, follow_up_id, kind, cause, comment)
       values ($1, 'f0110000-0000-4000-8000-000000000002', 'closed_with_lead', 'declined', 'Called.')`,
      // A comment too short.
      `insert into public.follow_up_records (lead_id, kind, outcome, comment, method, contacted_by, contacted_at)
       values ($1, 'contact', 'lead_enrolled', 'ab', 'SMS', '${ADMISSIONS.id}', now())`,
    ]
    for (const query of queries) {
      await expect(
        inRolledBackTransaction(async (sql) => {
          await sql.query("select public.set_audit_actor('system')")
          await sql.query(query, [BARAKA])
        }),
        query,
      ).rejects.toThrow(/check constraint/)
    }
  })
})

describe("reading records", () => {
  test("shows the seeded contacts with their staff, a deactivated colleague's name included", async () => {
    const read = await getLeadFollowUps(await signedIn(ACCOUNTANT), BARAKA)
    if (!read.ok) throw new Error("read failed")
    expect(read.data.records).toEqual([
      expect.objectContaining({
        id: BARAKA_CALL,
        method: "Phone call",
        contactedBy: { id: DEACTIVATED.id, name: DEACTIVATED.name },
        nextFollowUpId: read.data.open?.id,
      }),
    ])
    // Entered a day after the call.
    const [call] = read.data.records
    expect(Date.parse(call.enteredAt) - Date.parse(call.contactedAt!)).toBeGreaterThan(3_600_000)

    const neema = await getLeadFollowUps(await signedIn(ADMISSIONS), NEEMA)
    expect(neema).toMatchObject({ ok: true, data: { records: [{ id: NEEMA_WHATSAPP, followUpId: null, method: "WhatsApp" }] } })
  })

  test("visitors who are not signed in, and staff without leads.view, read nothing", async () => {
    const outsider = await signedIn(await createThrowawayStaff(["payments.view"]))
    for (const client of [anonClient(), outsider]) {
      const rows = await client.from("follow_up_records").select("id")
      expect(rows.data ?? []).toEqual([])
      expect(await getLeadFollowUps(client, BARAKA)).toEqual({ ok: true, data: { open: null, earlier: [], records: [] } })
      const names = await client.rpc("follow_up_record_staff", { lead_id: BARAKA })
      expect(names.data ?? []).toEqual([])
    }
  })
})

describe("the staff who made the contact", () => {
  test("lists active staff who record contacts, with only their id and name", async () => {
    const listed = await listContactStaff(await signedIn(ADMISSIONS))
    if (!listed.ok) throw new Error("list failed")
    const ids = listed.data.map((person) => person.id)
    for (const person of [MANAGER, SECOND_MANAGER, ADMISSIONS]) expect(ids, person.email).toContain(person.id)
    for (const person of [DEACTIVATED, RETIRED_ROLE, ACCOUNTANT]) expect(ids, person.email).not.toContain(person.id)
    expect(listed.data).toContainEqual({ id: ADMISSIONS.id, name: ADMISSIONS.name })
    for (const person of listed.data) expect(Object.keys(person).sort()).toEqual(["id", "name"])
  })

  test("leaves out a colleague once deactivated", async () => {
    const colleague = await createThrowawayStaff(["leads.view", "follow_ups.record"])
    const staff = await signedIn(ADMISSIONS)
    const before = await listContactStaff(staff)
    expect(before.ok && before.data.map((p) => p.id)).toContain(colleague.id)

    await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [colleague.id]))
    const after = await listContactStaff(staff)
    expect(after.ok && after.data.map((p) => p.id)).not.toContain(colleague.id)
  })

  test("is refused to the Accountant and to visitors not signed in", async () => {
    for (const client of [await signedIn(ACCOUNTANT), anonClient()]) {
      expect(await listContactStaff(client)).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
  })
})

describe("records in the lead's history", () => {
  test("records the contact with the staff member who entered it and what was said", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    const recorded = await recordFollowUp(await signedIn(MANAGER), lead, contact(planned, { contactedBy: ADMISSIONS.id, method: "SMS" }))
    if (!recorded.ok) throw new Error("record failed")

    const history = await getLeadHistory(await signedIn(ADMISSIONS), lead)
    if (!history.ok) throw new Error("history failed")
    const entries = history.data.entries.filter((e) => e.record === "follow_up_records")
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ action: "insert", actor: MANAGER.name, recordId: recorded.data.recordId })
    expect(entries[0].changes).toEqual(
      expect.arrayContaining([
        { field: "kind", from: null, to: "contact" },
        { field: "outcome", from: null, to: "next_date" },
        { field: "comment", from: null, to: "Spoke with the father about the interview date." },
        { field: "method", from: null, to: "SMS" },
        { field: "contacted_by", from: null, to: ADMISSIONS.id },
        { field: "follow_up_id", from: null, to: planned },
      ]),
    )
    // The next follow-up is in the history too.
    expect(history.data.entries.filter((e) => e.record === "follow_ups")).toHaveLength(2)
  })

  test("a refused record leaves no history", async () => {
    const lead = await newLead()
    await recordFollowUp(await signedIn(ACCOUNTANT), lead, contact(null))
    const history = await getLeadHistory(await signedIn(ADMISSIONS), lead)
    expect(history.ok && history.data.entries.filter((e) => e.record === "follow_up_records" || e.record === "follow_ups")).toEqual([])
  })
})
