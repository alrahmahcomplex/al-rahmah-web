import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  changeFollowUpDate,
  getFollowUpQueue,
  getLeadFollowUps,
  recordFollowUp,
  scheduleFollowUp,
  type FollowUpQueueItem,
  type FollowUpQueueSection,
} from "@/lib/services/follow-ups"
import { createLead } from "@/lib/services/leads"

import { asStaffActor, asSystem, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER } from "../support/fixtures"

// A lead's open follow-up closing with the lead (#93), against local
// Supabase. The tests close leads from outside slice 7, as the database owner
// with an audit actor, the way slice 2's seed does: whichever route sets the
// status or the closure mark, the follow-up closes with it.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      contact: { fullName: "Closing Parent", relationship: "Mother", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Closing ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
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

// The three ways a lead closes, each as the statement slice 8 or a lifecycle
// intervention would run.
const CLOSINGS = {
  declined: "update public.leads set status = 'Declined', declined_reason = 'Family changed plans' where id = $1",
  inactive: "update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1",
  archived: "update public.leads set closure = 'Archived', closure_reason = 'Admission cycle ended' where id = $1",
} as const

async function close(leadId: string, cause: keyof typeof CLOSINGS, actor = MANAGER.id) {
  await asStaffActor(actor, (sql) => sql.query(CLOSINGS[cause], [leadId]))
}

async function followUpsOf(leadId: string) {
  const read = await getLeadFollowUps(await signedIn(ADMISSIONS), leadId)
  if (!read.ok) throw new Error(`read failed: ${JSON.stringify(read.error)}`)
  return read.data
}

// Every item in a section, page by page.
async function wholeSection(supabase: SupabaseClient, section: FollowUpQueueSection): Promise<FollowUpQueueItem[]> {
  const items: FollowUpQueueItem[] = []
  for (let page = 1; ; page++) {
    const read = await getFollowUpQueue(supabase, { section, page })
    if (!read.ok) throw new Error("queue read failed")
    items.push(...read.data.items)
    if (page >= read.data.pageCount) return items
  }
}

// A direct connection as the database owner, for holding a transaction open
// while another one runs.
async function connection(): Promise<Client> {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  // A deadlock or a lost wake-up fails the test instead of hanging it.
  await sql.query("set statement_timeout = '15s'")
  return sql
}

// Whether a promise is still waiting after a moment.
async function stillWaiting(promise: Promise<unknown>): Promise<boolean> {
  const waiting = Symbol("waiting")
  const first = await Promise.race([promise.then(() => null, () => null), new Promise((resolve) => setTimeout(() => resolve(waiting), 500))])
  return first === waiting
}

describe("closing a lead closes its open follow-up", () => {
  for (const cause of ["declined", "inactive", "archived"] as const) {
    test(`writes a record with cause ${cause}`, async () => {
      const lead = await newLead()
      const planned = await scheduled(lead)

      await close(lead, cause)

      const read = await followUpsOf(lead)
      expect(read.open).toBeNull()
      expect(read.earlier).toEqual([expect.objectContaining({ id: planned })])
      expect(read.records).toEqual([
        {
          id: expect.any(String),
          kind: "closed_with_lead",
          followUpId: planned,
          outcome: null,
          cause,
          comment: null,
          method: null,
          contactedBy: null,
          contactedAt: null,
          enteredAt: expect.any(String),
          nextFollowUpId: null,
        },
      ])
    })
  }

  test("closes the follow-up a changed date left open, not the one it replaced", async () => {
    const lead = await newLead()
    await scheduled(lead)
    const staff = await signedIn(ADMISSIONS)
    const open = (await followUpsOf(lead)).open
    if (!open) throw new Error("no open follow-up")
    const moved = await changeFollowUpDate(staff, open.id, { dueOn: addDays(today, 5), reason: "The parent is travelling." })
    if (!moved.ok) throw new Error("change failed")

    await close(lead, "archived")

    const read = await followUpsOf(lead)
    expect(read.open).toBeNull()
    expect(read.records).toEqual([expect.objectContaining({ kind: "closed_with_lead", followUpId: moved.data.followUpId, cause: "archived" })])
  })

  test("writes nothing when no follow-up is open", async () => {
    const neverPlanned = await newLead()
    await close(neverPlanned, "declined")
    expect((await followUpsOf(neverPlanned)).records).toEqual([])

    // A follow-up a contact already completed stays completed: an Enrolled
    // lead ends a contact with no next date, then closes.
    const completed = await newLead()
    const planned = await scheduled(completed)
    await asSystem((sql) => sql.query("update public.leads set status = 'Enrolled' where id = $1", [completed]))
    const recorded = await recordFollowUp(await signedIn(ADMISSIONS), completed, {
      followUpId: planned,
      comment: "Welcomed the family to the school.",
      method: "Phone call",
      contactedBy: ADMISSIONS.id,
      contactedAt: new Date(Date.now() - 60_000).toISOString(),
      outcome: { kind: "lead_enrolled" },
    })
    if (!recorded.ok) throw new Error(`record failed: ${JSON.stringify(recorded.error)}`)
    await close(completed, "archived")
    expect((await followUpsOf(completed)).records).toEqual([expect.objectContaining({ kind: "contact", outcome: "lead_enrolled" })])
  })

  test("writes nothing more when a Declined lead is then archived", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    await close(lead, "declined")
    // A closure mark on a Declined lead goes through the close override, as
    // mark_lead sets it.
    await asStaffActor(MANAGER.id, async (sql) => {
      await sql.query("select public.set_lead_lifecycle_override('close')")
      await sql.query(CLOSINGS.archived, [lead])
    })

    expect((await followUpsOf(lead)).records).toEqual([
      expect.objectContaining({ kind: "closed_with_lead", followUpId: planned, cause: "declined" }),
    ])
  })

  test("other changes to an open lead leave its follow-up open", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    await asSystem((sql) => sql.query("update public.leads set class_name = 'STD 4' where id = $1", [lead]))
    const read = await followUpsOf(lead)
    expect(read.open?.id).toBe(planned)
    expect(read.records).toEqual([])
    // Out of the queue the browser tests read.
    await close(lead, "archived")
  })
})

describe("the queue", () => {
  test("drops the closed lead, and its old follow-up stays closed if the lead reopens", async () => {
    const lead = await newLead()
    const planted = await asSystem(async (sql) => {
      const row = await sql.query<{ id: string }>("insert into public.follow_ups (lead_id, due_on) values ($1, $2) returning id", [
        lead,
        addDays(today, -3),
      ])
      return row.rows[0].id
    })
    const staff = await signedIn(ADMISSIONS)
    expect((await wholeSection(staff, "overdue")).map((item) => item.followUpId)).toContain(planted)

    await close(lead, "inactive")
    expect((await wholeSection(staff, "overdue")).map((item) => item.lead.id)).not.toContain(lead)

    // Reopened, as an approved reopening would, the lead has no open
    // follow-up left to show.
    await asSystem(async (sql) => {
      await sql.query("select public.set_lead_lifecycle_override('reopen')")
      await sql.query("update public.leads set closure = null, closure_reason = null, closed_at = null, closed_by = null where id = $1", [
        lead,
      ])
    })
    const ids = [...(await wholeSection(staff, "overdue")), ...(await wholeSection(staff, "upcoming"))].map((item) => item.lead.id)
    expect(ids).not.toContain(lead)
    expect((await followUpsOf(lead)).open).toBeNull()
  })
})

describe("the lead's history", () => {
  test("names whoever closed the lead, with the cause", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)
    await close(lead, "declined", MANAGER.id)

    const history = await getLeadHistory(await signedIn(ADMISSIONS), lead)
    if (!history.ok) throw new Error("history failed")
    const entries = history.data.entries.filter((entry) => entry.record === "follow_up_records")
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ action: "insert", actor: MANAGER.name })
    expect(entries[0].changes).toEqual(
      expect.arrayContaining([
        { field: "kind", from: null, to: "closed_with_lead" },
        { field: "cause", from: null, to: "declined" },
        { field: "follow_up_id", from: null, to: planned },
      ]),
    )
  })
})

describe("closing alongside a follow-up write", () => {
  test("a contact recorded while the lead is being declined waits, then is refused as read-only", async () => {
    const lead = await newLead()
    const planned = await scheduled(lead)

    const closer = await connection()
    try {
      await closer.query("begin")
      await closer.query("select public.set_audit_actor('staff', $1)", [MANAGER.id])
      await closer.query(CLOSINGS.declined, [lead])

      const recording = recordFollowUp(await signedIn(ADMISSIONS), lead, {
        followUpId: planned,
        comment: "The family said they will not continue.",
        method: "Phone call",
        contactedBy: ADMISSIONS.id,
        contactedAt: new Date(Date.now() - 60_000).toISOString(),
        outcome: { kind: "next_date", dueOn: addDays(today, 7) },
      })
      expect(await stillWaiting(recording)).toBe(true)
      await closer.query("commit")

      expect(await recording).toEqual({ ok: false, error: { kind: "read-only" } })
    } finally {
      await closer.end()
    }

    expect((await followUpsOf(lead)).records).toEqual([
      expect.objectContaining({ kind: "closed_with_lead", followUpId: planned, cause: "declined" }),
    ])
  })

  test("a lead closed while a follow-up is being scheduled waits, then closes the new follow-up", async () => {
    const lead = await newLead()

    // The scheduler takes the locks schedule_follow_up takes, in its order:
    // the lead row shared, then the lead's advisory lock.
    const scheduler = await connection()
    const closer = await connection()
    let planned: string
    try {
      await scheduler.query("begin")
      await scheduler.query("select public.set_audit_actor('staff', $1)", [ADMISSIONS.id])
      await scheduler.query("select 1 from public.leads where id = $1 for share", [lead])
      await scheduler.query("select pg_advisory_xact_lock(hashtextextended('follow-up-lead:' || $1::text, 0))", [lead])

      await closer.query("begin")
      await closer.query("select public.set_audit_actor('staff', $1)", [MANAGER.id])
      const closing = closer.query(CLOSINGS.archived, [lead])
      expect(await stillWaiting(closing)).toBe(true)

      const row = await scheduler.query<{ id: string }>("insert into public.follow_ups (lead_id, due_on) values ($1, $2) returning id", [
        lead,
        addDays(today, 3),
      ])
      planned = row.rows[0].id
      await scheduler.query("commit")

      await closing
      await closer.query("commit")
    } finally {
      await scheduler.end()
      await closer.end()
    }

    const read = await followUpsOf(lead)
    expect(read.open).toBeNull()
    expect(read.records).toEqual([expect.objectContaining({ kind: "closed_with_lead", followUpId: planned, cause: "archived" })])
  })
})
