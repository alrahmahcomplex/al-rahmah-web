import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  getFollowUpQueue,
  getOverdueCount,
  recordFollowUp,
  type FollowUpQueueItem,
  type FollowUpQueueSection,
} from "@/lib/services/follow-ups"
import { createLead } from "@/lib/services/leads"

import { anonClient, asSystem, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The Follow-ups queue (#92) through the follow-up module, against local
// Supabase. Follow-ups dated in the past can't be scheduled through the
// module, so the tests plant them as the database owner. Every lead a test
// puts in the queue is archived afterwards, so the queue the browser tests
// read stays the seeded one.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

const made: string[] = []

afterAll(async () => {
  if (made.length === 0) return
  await asSystem((sql) =>
    sql.query(
      "update public.leads set closure = 'Archived', closure_reason = 'Duplicate record' where id = any($1) and closure is null and status <> 'Declined'",
      [made],
    ),
  )
})

async function newLead(guardianName = "Queue Parent"): Promise<{ id: string; admissionNumber: string; phone: string }> {
  const phone = `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: guardianName, relationship: "Mother", phone } },
    student: { fullName: `Queue ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  made.push(created.data.leadId)
  return { id: created.data.leadId, admissionNumber: created.data.admissionNumber, phone: `+255${phone.slice(1)}` }
}

// Plants an open follow-up, as the owner, on any date.
async function plant(leadId: string, dueOn: string, note: string | null = null): Promise<string> {
  return asSystem(async (sql) => {
    const row = await sql.query<{ id: string }>(
      "insert into public.follow_ups (lead_id, due_on, note) values ($1, $2, $3) returning id",
      [leadId, dueOn, note],
    )
    return row.rows[0].id
  })
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

const leadIds = (items: FollowUpQueueItem[], among: string[]) =>
  items.map((item) => item.lead.id).filter((id) => among.includes(id))

describe("the queue's sections", () => {
  test("Overdue runs oldest first, then by Admission Number; today's stays in Upcoming, which runs nearest first", async () => {
    const [a, b, c, dueToday, later] = await Promise.all([newLead(), newLead(), newLead(), newLead(), newLead()])
    await plant(a.id, addDays(today, -40))
    await plant(b.id, addDays(today, -40))
    await plant(c.id, addDays(today, -1))
    await plant(dueToday.id, today)
    await plant(later.id, addDays(today, 2))
    const mine = [a, b, c, dueToday, later].map((lead) => lead.id)
    const sameDay = [a, b].sort((x, y) => x.admissionNumber.localeCompare(y.admissionNumber)).map((lead) => lead.id)

    const staff = await signedIn(ADMISSIONS)
    const overdue = await wholeSection(staff, "overdue")
    const upcoming = await wholeSection(staff, "upcoming")

    expect(leadIds(overdue, mine)).toEqual([...sameDay, c.id])
    expect(leadIds(upcoming, mine)).toEqual([dueToday.id, later.id])
    expect(overdue.map((item) => item.dueOn)).toEqual([...overdue.map((item) => item.dueOn)].sort())
    expect(upcoming.map((item) => item.dueOn)).toEqual([...upcoming.map((item) => item.dueOn)].sort())
    expect(upcoming.find((item) => item.lead.id === dueToday.id)).toMatchObject({ dueOn: today, daysOverdue: 0 })
  })

  test("a row carries the lead, the date, days overdue, the note, the guardian and the last contact", async () => {
    const lead = await newLead("Rehema Queue")
    const planted = await plant(lead.id, addDays(today, -6), "Ask about the boarding house.")
    const staff = await signedIn(ADMISSIONS)

    const overdue = await wholeSection(staff, "overdue")
    expect(overdue.find((item) => item.lead.id === lead.id)).toEqual({
      kind: "follow_up",
      followUpId: planted,
      dueOn: addDays(today, -6),
      daysOverdue: 6,
      note: "Ask about the boarding house.",
      lead: {
        id: lead.id,
        admissionNumber: lead.admissionNumber,
        studentName: expect.stringMatching(/^Queue /),
        className: "STD 4",
        enrollmentYear: thisYear + 1,
        status: "Visited",
      },
      guardian: { name: "Rehema Queue", phone: lead.phone },
      lastContact: null,
    })

    // Recording the contact moves the lead to Upcoming with its next date,
    // and the row names how and when the family was last reached.
    const contactedAt = new Date(Date.now() - 2 * 60 * 60_000).toISOString()
    const recorded = await recordFollowUp(staff, lead.id, {
      followUpId: planted,
      comment: "The mother will visit the boarding house on Saturday.",
      method: "WhatsApp",
      contactedBy: ADMISSIONS.id,
      contactedAt,
      outcome: { kind: "next_date", dueOn: addDays(today, 3) },
    })
    expect(recorded.ok).toBe(true)

    expect(leadIds(await wholeSection(staff, "overdue"), [lead.id])).toEqual([])
    const upcoming = (await wholeSection(staff, "upcoming")).filter((item) => item.lead.id === lead.id)
    expect(upcoming).toEqual([
      expect.objectContaining({ dueOn: addDays(today, 3), daysOverdue: 0, lastContact: { method: "WhatsApp", contactedAt: expect.any(String) } }),
    ])
    expect(Date.parse(upcoming[0].lastContact!.contactedAt)).toBe(Date.parse(contactedAt))
  })
})

describe("what the queue leaves out", () => {
  test("Declined, Inactive, Archived and Enrolled leads", async () => {
    const leads = await Promise.all([newLead(), newLead(), newLead(), newLead(), newLead()])
    for (const lead of leads) await plant(lead.id, addDays(today, -3))
    const [declined, inactive, archived, enrolled, stays] = leads.map((lead) => lead.id)
    await asSystem(async (sql) => {
      await sql.query("update public.leads set status = 'Declined', declined_reason = 'School decision' where id = $1", [declined])
      await sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [inactive])
      await sql.query("update public.leads set closure = 'Archived', closure_reason = 'Duplicate record' where id = $1", [archived])
      await sql.query("update public.leads set status = 'Enrolled' where id = $1", [enrolled])
    })

    const staff = await signedIn(MANAGER)
    const all = leads.map((lead) => lead.id)
    expect(leadIds(await wholeSection(staff, "overdue"), all)).toEqual([stays])
    expect(leadIds(await wholeSection(staff, "upcoming"), all)).toEqual([])
  })

  test("a lead that drops back out of Enrolled returns with its old follow-up", async () => {
    const lead = await newLead()
    const planted = await plant(lead.id, addDays(today, -9))
    const staff = await signedIn(ADMISSIONS)

    await asSystem((sql) => sql.query("update public.leads set status = 'Enrolled' where id = $1", [lead.id]))
    expect(leadIds(await wholeSection(staff, "overdue"), [lead.id])).toEqual([])

    await asSystem((sql) => sql.query("update public.leads set status = 'Visited' where id = $1", [lead.id]))
    const back = (await wholeSection(staff, "overdue")).filter((item) => item.lead.id === lead.id)
    expect(back).toEqual([expect.objectContaining({ followUpId: planted, dueOn: addDays(today, -9), daysOverdue: 9 })])
  })
})

describe("the overdue count and paging", () => {
  test("the count is the Overdue total, and a new overdue follow-up adds one", async () => {
    const staff = await signedIn(ADMISSIONS)
    const before = await getOverdueCount(staff)
    const page = await getFollowUpQueue(staff, { section: "overdue", page: 1 })
    expect(before.ok && page.ok && before.data).toBe(page.ok && page.data.total)

    await plant((await newLead()).id, addDays(today, -2))
    // An upcoming one counts for nothing.
    await plant((await newLead()).id, addDays(today, 2))
    expect(await getOverdueCount(staff)).toEqual({ ok: true, data: (before.ok ? before.data : 0) + 1 })
  })

  test("a section pages 50 rows at a time, and a page past the end is empty", async () => {
    // Older than anything else in the queue, so these fill the first page.
    // Planted in one transaction on one family, as the owner: 54 leads made
    // through the API at once would load the database the other tests share.
    const oldest = addDays(today, -3000)
    const guardian = await newLead()
    const leads = await asSystem(async (sql) => {
      const numbers = await sql.query<{ admission_number: string }>(
        `select format('ADMSN-%s', lpad(n::text, 5, '0')) as admission_number
           from generate_series(0, 99999) n
          where not exists (select 1 from public.leads l where l.admission_number = format('ADMSN-%s', lpad(n::text, 5, '0')))
          order by random() limit 54`,
      )
      const planted = await sql.query<{ id: string }>(
        `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date, guardian_contact_id)
         select number, 'Paged ' || number, 'STD 4', $2, 'Day', 'Visited', $3::date,
                (select guardian_contact_id from public.leads where id = $4)
           from unnest($1::text[]) as number
         returning id`,
        [numbers.rows.map((row) => row.admission_number), thisYear + 1, today, guardian.id],
      )
      const ids = planted.rows.map((row) => row.id)
      await sql.query("insert into public.follow_ups (lead_id, due_on) select unnest($1::uuid[]), $2::date", [ids, oldest])
      return ids
    })
    made.push(...leads)
    const staff = await signedIn(ADMISSIONS)

    const first = await getFollowUpQueue(staff, { section: "overdue", page: 1 })
    const second = await getFollowUpQueue(staff, { section: "overdue", page: 2 })
    if (!first.ok || !second.ok) throw new Error("queue read failed")
    expect(first.data.items).toHaveLength(50)
    expect(first.data.items.every((item) => item.dueOn === oldest)).toBe(true)
    expect(first.data.total).toBeGreaterThanOrEqual(54)
    expect(first.data.pageCount).toBe(Math.ceil(first.data.total / 50))
    expect(second.data.items.slice(0, 4).map((item) => item.dueOn)).toEqual([oldest, oldest, oldest, oldest])
    const firstIds = new Set(first.data.items.map((item) => item.lead.id))
    expect(second.data.items.some((item) => firstIds.has(item.lead.id))).toBe(false)

    const past = await getFollowUpQueue(staff, { section: "overdue", page: first.data.pageCount + 1 })
    expect(past).toEqual({
      ok: true,
      data: { section: "overdue", items: [], total: first.data.total, page: first.data.pageCount + 1, pageCount: first.data.pageCount },
    })
  })
})

describe("who reads the queue", () => {
  test("the Accountant reads it like anyone else", async () => {
    const lead = await newLead()
    await plant(lead.id, addDays(today, -5))
    expect(leadIds(await wholeSection(await signedIn(ACCOUNTANT), "overdue"), [lead.id])).toEqual([lead.id])
  })

  test("anon reads nothing", async () => {
    const lead = await newLead()
    await plant(lead.id, addDays(today, -5))
    const anon = anonClient()
    expect(await getFollowUpQueue(anon, { section: "overdue", page: 1 })).toEqual({
      ok: true,
      data: { section: "overdue", items: [], total: 0, page: 1, pageCount: 1 },
    })
    expect(await getFollowUpQueue(anon, { section: "upcoming", page: 1 })).toMatchObject({ ok: true, data: { items: [] } })
    expect(await getOverdueCount(anon)).toEqual({ ok: true, data: 0 })
    // Not even by calling the database directly.
    const direct = await anon.rpc("follow_up_queue", { section: "overdue", page: 1 })
    expect(direct.data).toBeNull()
    expect(direct.error?.code).toBe("42501")
  })
})
