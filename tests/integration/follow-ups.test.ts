import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { changeFollowUpDate, getLeadFollowUps, scheduleFollowUp } from "@/lib/services/follow-ups"
import { createLead } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER } from "../support/fixtures"

// Scheduling a follow-up and changing its date through the follow-up module,
// against local Supabase. Each test makes its own leads; the seeded ones are
// only read or refused.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 2's seeded closed leads.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"
// Slice 7's seeded follow-ups: Salma's was moved a week out.
const SALMA = "1ead0000-0000-4000-8000-000000000004"
const SALMA_EARLIER = "f0110000-0000-4000-8000-000000000004"
const SALMA_OPEN = "f0110000-0000-4000-8000-000000000014"
const HAMISI_FOLLOW_UP = "f0110000-0000-4000-8000-000000000005"

// A YYYY-MM-DD date `days` after `date`.
function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Follow-up Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function followUpsOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ id: string; due_on: string; replaces_id: string | null }>(
          "select id, to_char(due_on, 'YYYY-MM-DD') as due_on, replaces_id from public.follow_ups where lead_id = $1 order by created_at",
          [leadId],
        )
      ).rows,
  )
}

describe("scheduling a follow-up", () => {
  test("plans the next contact with a date and a note, and shows it as the open follow-up", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)

    const scheduled = await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 1), note: "  Ask about the bus route.  " })
    expect(scheduled).toEqual({ ok: true, data: { followUpId: expect.any(String) } })

    const read = await getLeadFollowUps(staff, lead)
    expect(read).toEqual({
      ok: true,
      data: {
        open: {
          id: scheduled.ok && scheduled.data.followUpId,
          dueOn: addDays(today, 1),
          note: "Ask about the bus route.",
          replacesId: null,
          changeReason: null,
          createdAt: expect.any(String),
        },
        earlier: [],
      },
    })
  })

  test("a lead with none has no open follow-up", async () => {
    expect(await getLeadFollowUps(await signedIn(ADMISSIONS), await newLead())).toEqual({
      ok: true,
      data: { open: null, earlier: [] },
    })
  })

  test("the note is optional and at most 500 characters", async () => {
    const staff = await signedIn(MANAGER)
    const [one, other] = await Promise.all([newLead(), newLead()])

    expect(await scheduleFollowUp(staff, one, { dueOn: today, note: "x".repeat(501) })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "note" },
    })
    expect(await scheduleFollowUp(staff, one, { dueOn: today, note: "x".repeat(500) })).toMatchObject({ ok: true })
    expect(await scheduleFollowUp(staff, other, { dueOn: today })).toMatchObject({ ok: true })
    expect(await getLeadFollowUps(staff, other)).toMatchObject({ ok: true, data: { open: { note: null } } })
  })

  test("a lead has at most one open follow-up: a second is a conflict", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)

    expect(await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 2) })).toMatchObject({ ok: true })
    expect(await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 3) })).toEqual({ ok: false, error: { kind: "conflict" } })
    expect(await followUpsOf(lead)).toHaveLength(1)
  })

  test("two staff scheduling the same lead at once schedule it once", async () => {
    const lead = await newLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      scheduleFollowUp(one, lead, { dueOn: addDays(today, 1) }),
      scheduleFollowUp(other, lead, { dueOn: addDays(today, 2) }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { kind: "conflict" } }])
    expect(await followUpsOf(lead)).toHaveLength(1)
  })

  test("takes a date from today to 365 days ahead in Tanzania time", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const days of [-1, 366]) {
      const lead = await newLead()
      expect(await scheduleFollowUp(staff, lead, { dueOn: addDays(today, days) }), String(days)).toEqual({
        ok: false,
        error: { kind: "invalid", field: "due_on" },
      })
    }
    for (const days of [0, 365]) {
      const lead = await newLead()
      expect(await scheduleFollowUp(staff, lead, { dueOn: addDays(today, days) }), String(days)).toMatchObject({ ok: true })
    }
    const lead = await newLead()
    expect(await scheduleFollowUp(staff, lead, { dueOn: "not-a-date" })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "due_on" },
    })
  })

  test("today is Tanzania's date: either side of its midnight", async () => {
    // 20:59 UTC is 23:59 in Dar es Salaam, still the same day; 21:00 UTC is
    // already the next. The database's today follows its clock, so the rule
    // is checked against what it reports.
    const [{ tz_today }] = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query<{ tz_today: string }>(
            `select to_char((timestamptz '2026-03-01 20:59:00+00' at time zone 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD') || ' ' ||
                    to_char((timestamptz '2026-03-01 21:00:00+00' at time zone 'Africa/Dar_es_Salaam')::date, 'YYYY-MM-DD') as tz_today`,
          )
        ).rows,
    )
    expect(tz_today).toBe("2026-03-01 2026-03-02")
    expect(tanzaniaToday(new Date("2026-03-01T20:59:00Z"))).toBe("2026-03-01")
    expect(tanzaniaToday(new Date("2026-03-01T21:00:00Z"))).toBe("2026-03-02")

    // And the write takes Tanzania's today, which the app computes the same way.
    const [{ db_today }] = await inRolledBackTransaction(
      async (sql) => (await sql.query<{ db_today: string }>("select to_char(public.tanzania_today(), 'YYYY-MM-DD') as db_today")).rows,
    )
    expect(db_today).toBe(tanzaniaToday())
  })

  test("refuses the seeded Declined and Archived leads as read-only", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const lead of [DECLINED, ARCHIVED]) {
      expect(await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 1) }), lead).toEqual({
        ok: false,
        error: { kind: "read-only" },
      })
    }
    expect(await followUpsOf(DECLINED)).toEqual([])
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await scheduleFollowUp(staff, randomUUID(), { dueOn: today })).toEqual({ ok: false, error: { kind: "not-found" } })
    expect(await scheduleFollowUp(staff, "not-a-uuid", { dueOn: today })).toEqual({ ok: false, error: { kind: "not-found" } })
  })
})

describe("changing a follow-up's date", () => {
  test("adds a follow-up that replaces the earlier one, keeping it, its date and the reason", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const first = await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 1), note: "Call about uniforms." })
    if (!first.ok) throw new Error("schedule failed")

    const changed = await changeFollowUpDate(staff, first.data.followUpId, { dueOn: addDays(today, 5), reason: "  Parent is travelling.  " })
    expect(changed).toEqual({ ok: true, data: { followUpId: expect.any(String) } })

    const read = await getLeadFollowUps(staff, lead)
    expect(read).toEqual({
      ok: true,
      data: {
        open: {
          id: changed.ok && changed.data.followUpId,
          dueOn: addDays(today, 5),
          // The note carries over when no new one is given.
          note: "Call about uniforms.",
          replacesId: first.data.followUpId,
          changeReason: "Parent is travelling.",
          createdAt: expect.any(String),
        },
        earlier: [
          {
            id: first.data.followUpId,
            dueOn: addDays(today, 1),
            note: "Call about uniforms.",
            replacesId: null,
            changeReason: null,
            createdAt: expect.any(String),
          },
        ],
      },
    })
  })

  test("a new note replaces the earlier one", async () => {
    const lead = await newLead()
    const staff = await signedIn(MANAGER)
    const first = await scheduleFollowUp(staff, lead, { dueOn: today, note: "Old note." })
    if (!first.ok) throw new Error("schedule failed")

    await changeFollowUpDate(staff, first.data.followUpId, { dueOn: addDays(today, 2), reason: "Office closed.", note: "New note." })
    expect(await getLeadFollowUps(staff, lead)).toMatchObject({ ok: true, data: { open: { note: "New note." } } })
  })

  test("needs a reason of 3 to 500 characters and a date in range", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const first = await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 1) })
    if (!first.ok) throw new Error("schedule failed")
    const id = first.data.followUpId

    for (const reason of ["", "  ab  ", "x".repeat(501)]) {
      expect(await changeFollowUpDate(staff, id, { dueOn: addDays(today, 2), reason }), reason).toEqual({
        ok: false,
        error: { kind: "invalid", field: "reason" },
      })
    }
    for (const days of [-1, 366]) {
      expect(await changeFollowUpDate(staff, id, { dueOn: addDays(today, days), reason: "Moved." }), String(days)).toEqual({
        ok: false,
        error: { kind: "invalid", field: "due_on" },
      })
    }
    expect(await followUpsOf(lead)).toHaveLength(1)
  })

  test("a change has to move the date: the same date again is refused and records nothing", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const first = await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 3) })
    if (!first.ok) throw new Error("schedule failed")

    expect(await changeFollowUpDate(staff, first.data.followUpId, { dueOn: addDays(today, 3), reason: "No change." })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "due_on" },
    })
    expect(await followUpsOf(lead)).toHaveLength(1)
  })

  test("a follow-up already replaced is a conflict, so two changes at once make one", async () => {
    const lead = await newLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])
    const first = await scheduleFollowUp(one, lead, { dueOn: addDays(today, 1) })
    if (!first.ok) throw new Error("schedule failed")

    const results = await Promise.all([
      changeFollowUpDate(one, first.data.followUpId, { dueOn: addDays(today, 3), reason: "First change." }),
      changeFollowUpDate(other, first.data.followUpId, { dueOn: addDays(today, 4), reason: "Second change." }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: { kind: "conflict" } }])
    expect(await followUpsOf(lead)).toHaveLength(2)
  })

  test("refuses a follow-up on a closed lead as read-only", async () => {
    expect(
      await changeFollowUpDate(await signedIn(ADMISSIONS), HAMISI_FOLLOW_UP, { dueOn: addDays(today, 2), reason: "Moved on." }),
    ).toEqual({ ok: false, error: { kind: "read-only" } })
  })

  test("refuses a follow-up whose lead closed after it was scheduled", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const first = await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 1) })
    if (!first.ok) throw new Error("schedule failed")
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive' where id = $1", [lead]))

    expect(await changeFollowUpDate(staff, first.data.followUpId, { dueOn: addDays(today, 2), reason: "Moved on." })).toEqual({
      ok: false,
      error: { kind: "read-only" },
    })
    expect(await followUpsOf(lead)).toHaveLength(1)
  })

  test("a follow-up that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const id of [randomUUID(), "nope"]) {
      expect(await changeFollowUpDate(staff, id, { dueOn: today, reason: "Moved." }), id).toEqual({
        ok: false,
        error: { kind: "not-found" },
      })
    }
  })
})

describe("reading follow-ups", () => {
  test("shows the seeded change on Salma's lead, with the earlier date kept", async () => {
    expect(await getLeadFollowUps(await signedIn(ACCOUNTANT), SALMA)).toEqual({
      ok: true,
      data: {
        open: expect.objectContaining({
          id: SALMA_OPEN,
          replacesId: SALMA_EARLIER,
          changeReason: "The parent is travelling until next week.",
        }),
        earlier: [expect.objectContaining({ id: SALMA_EARLIER, replacesId: null, changeReason: null })],
      },
    })
  })

  test("visitors who are not signed in, and staff without leads.view, read nothing", async () => {
    const outsider = await signedIn(await createThrowawayStaff(["payments.view"]))
    for (const client of [anonClient(), outsider]) {
      const rows = await client.from("follow_ups").select("id")
      expect(rows.data ?? []).toEqual([])
      expect(await getLeadFollowUps(client, SALMA)).toEqual({ ok: true, data: { open: null, earlier: [] } })
    }
  })
})

describe("who may schedule or change a follow-up", () => {
  test("the Accountant, deactivated staff and a role without follow_ups.record are refused", async () => {
    const lead = await newLead()
    const viewer = await createThrowawayStaff(["leads.view", "leads.edit"])
    for (const person of [ACCOUNTANT, DEACTIVATED, viewer]) {
      const client = await signedIn(person)
      expect(await scheduleFollowUp(client, lead, { dueOn: today }), person.email).toEqual({ ok: false, error: { kind: "forbidden" } })
      expect(await changeFollowUpDate(client, SALMA_OPEN, { dueOn: today, reason: "Moved." }), person.email).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      })
    }
    expect(await followUpsOf(lead)).toEqual([])
  })

  test("nobody outside a staff session may write, the secret key included", async () => {
    const lead = await newLead()
    for (const client of [anonClient(), secretClient()]) {
      expect(await scheduleFollowUp(client, lead, { dueOn: today })).toEqual({ ok: false, error: { kind: "forbidden" } })
      expect(await changeFollowUpDate(client, SALMA_OPEN, { dueOn: today, reason: "Moved." })).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      })
    }
    expect(await followUpsOf(lead)).toEqual([])
  })

  test("follow-ups are never updated or deleted, even by the database owner", async () => {
    await expect(
      asSystem((sql) => sql.query("update public.follow_ups set due_on = due_on + 1 where id = $1", [SALMA_OPEN])),
    ).rejects.toThrow("update_refused")
    await expect(
      inRolledBackTransaction((sql) => sql.query("delete from public.follow_ups where id = $1", [SALMA_OPEN])),
    ).rejects.toThrow("delete_refused")
    // And a signed-in session has no grant to try.
    const staff = await signedIn(MANAGER)
    const update = await staff.from("follow_ups").update({ note: "changed" }).eq("id", SALMA_OPEN).select("id")
    expect(update.error?.code).toBe("42501")
    const del = await staff.from("follow_ups").delete().eq("id", SALMA_OPEN).select("id")
    expect(del.error?.code).toBe("42501")
  })

  test("the database refuses a replacement without a reason, and a reason without one", async () => {
    for (const query of [
      "insert into public.follow_ups (lead_id, due_on, replaces_id) values ($1, current_date, $2)",
      "insert into public.follow_ups (lead_id, due_on, change_reason) values ($1, current_date, 'Because.')",
    ]) {
      await expect(
        inRolledBackTransaction(async (sql) => {
          await sql.query("select public.set_audit_actor('system')")
          await sql.query(query, query.includes("$2") ? [SALMA, SALMA_OPEN] : [SALMA])
        }),
        query,
      ).rejects.toThrow(/check constraint/)
    }
  })
})

describe("follow-ups in the lead's history", () => {
  test("records the scheduling and the change with the staff member, the dates and the reason", async () => {
    const lead = await newLead()
    const staff = await signedIn(ADMISSIONS)
    const first = await scheduleFollowUp(staff, lead, { dueOn: addDays(today, 1), note: "Bring the report card." })
    if (!first.ok) throw new Error("schedule failed")
    const changed = await changeFollowUpDate(await signedIn(MANAGER), first.data.followUpId, {
      dueOn: addDays(today, 6),
      reason: "School holiday.",
    })
    if (!changed.ok) throw new Error("change failed")

    const history = await getLeadHistory(staff, lead)
    if (!history.ok) throw new Error("history failed")
    const entries = history.data.entries.filter((e) => e.record === "follow_ups")
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ action: "insert", actor: MANAGER.name, recordId: changed.data.followUpId })
    expect(entries[0].changes).toEqual(
      expect.arrayContaining([
        { field: "due_on", from: null, to: addDays(today, 6) },
        { field: "replaces_id", from: null, to: first.data.followUpId },
        { field: "replaced_due_on", from: null, to: addDays(today, 1) },
        { field: "change_reason", from: null, to: "School holiday." },
      ]),
    )
    expect(entries[1]).toMatchObject({ action: "insert", actor: ADMISSIONS.name, recordId: first.data.followUpId })
    expect(entries[1].changes).toEqual(
      expect.arrayContaining([
        { field: "due_on", from: null, to: addDays(today, 1) },
        { field: "note", from: null, to: "Bring the report card." },
      ]),
    )
  })

  test("a refused write leaves no history", async () => {
    const lead = await newLead()
    await scheduleFollowUp(await signedIn(ACCOUNTANT), lead, { dueOn: today })
    const history = await getLeadHistory(await signedIn(ADMISSIONS), lead)
    expect(history.ok && history.data.entries.filter((e) => e.record === "follow_ups")).toEqual([])
  })
})
