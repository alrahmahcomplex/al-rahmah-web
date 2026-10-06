import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  CLOSURE_REASONS,
  declineLead,
  getLeadClosure,
  markLead,
  type ClosureReason,
  type MarkMove,
} from "@/lib/services/lead-closure"
import { createLead, updateLeadDetails, type LeadClosure, type LeadStatus } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Marking a lead Inactive or Archived through the lead closure module (#98),
// against local Supabase. Each test marks leads of its own; the seeded ones
// are only read or refused.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"
const INACTIVE = "1ead0000-0000-4000-8000-000000000083"
const DECLINED_AND_ARCHIVED = "1ead0000-0000-4000-8000-000000000084"

type MarkRow = {
  status: LeadStatus
  closure: LeadClosure | null
  closure_reason: ClosureReason | null
  closure_note: string | null
  closed_at: Date | null
  closed_by: string | null
  declined_reason: string | null
}

async function read(leadId: string): Promise<MarkRow> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<MarkRow>(
      `select status, closure, closure_reason, closure_note, closed_at, closed_by, declined_reason
       from public.leads where id = $1`,
      [leadId],
    )
    return rows[0]
  })
}

// A walk-in lead of the test's own: Visited.
async function newLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      // A leading 4 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' numbers.
      contact: { fullName: "Mark Parent", relationship: "Mother", phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Mark ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

describe("marking a lead", () => {
  test("marks an unmarked lead Inactive or Archived, keeping its status, with the reason, note, who and when", async () => {
    const [toInactive, toArchived] = await Promise.all([newLead(), newLead()])

    expect(
      await markLead(await signedIn(ADMISSIONS), toInactive, {
        mark: "inactive",
        reason: "No longer pursuing admission",
        note: "  Waiting on a job transfer.  ",
      }),
    ).toEqual({ ok: true, data: null })
    expect(await markLead(await signedIn(MANAGER), toArchived, { mark: "archived", reason: "Duplicate record" })).toEqual({
      ok: true,
      data: null,
    })

    const inactive = await read(toInactive)
    expect(inactive).toMatchObject({
      status: "Visited",
      closure: "Inactive",
      closure_reason: "No longer pursuing admission",
      closure_note: "Waiting on a job transfer.",
      closed_by: ADMISSIONS.id,
    })
    expect(Date.now() - inactive.closed_at!.getTime()).toBeLessThan(60_000)
    expect(await read(toArchived)).toMatchObject({
      status: "Visited",
      closure: "Archived",
      closure_reason: "Duplicate record",
      closure_note: null,
      closed_by: MANAGER.id,
    })
  })

  test("takes every closure reason, and a blank note counts as none", async () => {
    const staff = await signedIn(ADMISSIONS)
    const leads = await Promise.all(CLOSURE_REASONS.map(() => newLead()))

    for (const [i, reason] of CLOSURE_REASONS.entries()) {
      expect(await markLead(staff, leads[i], { mark: "inactive", reason, note: "   " }), reason).toEqual({ ok: true, data: null })
      expect(await read(leads[i]), reason).toMatchObject({ closure: "Inactive", closure_reason: reason, closure_note: null })
    }
  })

  test("moves an Inactive lead to Archived, with the new reason, note, who and when", async () => {
    const lead = await newLead()
    await markLead(await signedIn(ADMISSIONS), lead, { mark: "inactive", reason: "No longer pursuing admission", note: "Quiet." })

    expect(await markLead(await signedIn(MANAGER), lead, { mark: "archived", reason: "Admission cycle ended" })).toEqual({
      ok: true,
      data: null,
    })
    expect(await read(lead)).toMatchObject({
      status: "Visited",
      closure: "Archived",
      closure_reason: "Admission cycle ended",
      closure_note: null,
      closed_by: MANAGER.id,
    })
  })

  test("marks a Declined lead, which stays Declined with its decline", async () => {
    const staff = await signedIn(ADMISSIONS)
    const [archived, inactive] = await Promise.all([newLead(), newLead()])
    await declineLead(staff, archived, { reason: "Enrolled elsewhere" })
    await declineLead(staff, inactive, { reason: "Fees or cost" })

    expect(await markLead(staff, archived, { mark: "archived", reason: "Admission cycle ended" })).toEqual({ ok: true, data: null })
    expect(await markLead(staff, inactive, { mark: "inactive", reason: "Family requested closure" })).toEqual({ ok: true, data: null })

    expect(await read(archived)).toMatchObject({ status: "Declined", declined_reason: "Enrolled elsewhere", closure: "Archived" })
    expect(await read(inactive)).toMatchObject({ status: "Declined", declined_reason: "Fees or cost", closure: "Inactive" })
  })

  test("refuses an Archived lead any mark, and Inactive marked Inactive again, changing nothing", async () => {
    const staff = await signedIn(MANAGER)
    const lead = await newLead()
    await markLead(staff, lead, { mark: "inactive", reason: "Duplicate record" })
    const inactive = await read(lead)

    expect(await markLead(staff, lead, { mark: "inactive", reason: "Record created in error" })).toEqual({ ok: false, error: "invalid" })
    expect(await read(lead)).toEqual(inactive)

    for (const mark of ["inactive", "archived"] as const) {
      const before = await read(ARCHIVED)
      expect(await markLead(staff, ARCHIVED, { mark, reason: "Duplicate record" }), mark).toEqual({ ok: false, error: "invalid" })
      expect(await read(ARCHIVED), mark).toEqual(before)
    }
    expect(await markLead(staff, DECLINED_AND_ARCHIVED, { mark: "inactive", reason: "Duplicate record" })).toEqual({
      ok: false,
      error: "invalid",
    })
  })

  test("refuses an unknown mark or reason and an over-long note", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()

    expect(await markLead(staff, lead, { mark: "open" as MarkMove, reason: "Duplicate record" })).toEqual({ ok: false, error: "invalid" })
    expect(await markLead(staff, lead, { mark: "archived", reason: "Bored" as ClosureReason })).toEqual({ ok: false, error: "invalid" })
    expect(await markLead(staff, lead, { mark: "archived", reason: "Duplicate record", note: "x".repeat(1001) })).toEqual({
      ok: false,
      error: "invalid",
    })
    expect(await read(lead)).toMatchObject({ closure: null, closure_reason: null })
  })

  test("a mark is never removed or moved back outside a reopening", async () => {
    const lead = await newLead()
    await markLead(await signedIn(ADMISSIONS), lead, { mark: "archived", reason: "Duplicate record" })

    for (const change of [
      "closure = null, closure_reason = null",
      "closure = 'Inactive'",
      "closure_reason = 'Record created in error'",
    ]) {
      await expect(asSystem((sql) => sql.query(`update public.leads set ${change} where id = $1`, [lead])), change).rejects.toThrow(
        "lead_closed",
      )
    }
    await (await signedIn(MANAGER)).from("leads").update({ closure: null, closure_reason: null }).eq("id", lead)
    expect(await read(lead)).toMatchObject({ closure: "Archived", closure_reason: "Duplicate record" })
  })

  test("a marked lead is then read-only", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()
    await markLead(staff, lead, { mark: "inactive", reason: "Duplicate record" })

    expect(await updateLeadDetails(staff, lead, { className: "STD 5" })).toEqual({ ok: false, error: { kind: "closed" } })
  })

  test("two staff marking the same lead Inactive at once mark it once", async () => {
    const lead = await newLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      markLead(one, lead, { mark: "inactive", reason: "Duplicate record" }),
      markLead(other, lead, { mark: "inactive", reason: "Record created in error" }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "invalid" }])
  })

  test("lets only its own update through: later statements in the caller's transaction are guarded as before", async () => {
    const lead = await newLead()

    const answer = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [ADMISSIONS.id])
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: rows[0].user_id, role: "authenticated" }),
      ])
      await sql.query("set local role authenticated")
      await sql.query("select public.mark_lead($1, 'Inactive', 'Duplicate record', null)", [lead])
      await sql.query("reset role")
      await sql.query("select public.set_audit_actor('system')")
      try {
        await sql.query("update public.leads set class_name = 'STD 1' where id = $1", [lead])
        return "changed"
      } catch (error) {
        return (error as Error).message
      }
    })
    expect(answer).toBe("lead_closed")
  })

  test("the database keeps a mark and its reason together", async () => {
    const lead = await newLead()
    for (const change of ["closure = 'Inactive'", "closure_reason = 'Duplicate record'", "closure_note = 'A note'"]) {
      await expect(asSystem((sql) => sql.query(`update public.leads set ${change} where id = $1`, [lead])), change).rejects.toThrow(
        /check constraint/,
      )
    }
  })
})

describe("who may mark a lead", () => {
  test("Admissions Staff and the Manager may; the Accountant, a role without leads.close, the secret key and anon may not", async () => {
    const lead = await newLead()
    const viewer = await createThrowawayStaff(["leads.view", "leads.edit", "leads.decline"])
    const callers = {
      accountant: await signedIn(ACCOUNTANT),
      viewer: await signedIn(viewer),
      secret: secretClient(),
      anon: anonClient(),
    }

    for (const [who, caller] of Object.entries(callers)) {
      expect(await markLead(caller, lead, { mark: "archived", reason: "Duplicate record" }), who).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await read(lead)).toMatchObject({ closure: null })
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await markLead(staff, randomUUID(), { mark: "inactive", reason: "Duplicate record" })).toEqual({ ok: false, error: "not-found" })
    expect(await markLead(staff, "not-a-lead", { mark: "inactive", reason: "Duplicate record" })).toEqual({ ok: false, error: "not-found" })
  })
})

describe("reading a lead's closure mark", () => {
  test("names the mark, reason, note, who and when, for anyone who may view leads", async () => {
    const lead = await newLead()
    await markLead(await signedIn(ADMISSIONS), lead, { mark: "inactive", reason: "Family requested closure", note: "Call in January." })

    expect(await getLeadClosure(await signedIn(ACCOUNTANT), lead)).toEqual({
      ok: true,
      data: {
        decline: null,
        closure: {
          mark: "Inactive",
          reason: "Family requested closure",
          note: "Call in January.",
          closedAt: expect.any(String),
          closedBy: ADMISSIONS.name,
        },
        initiallyDeclined: false,
        reopenedAfterDecline: null,
      },
    })
  })

  test("reads the seeded marks, the decline beside a mark, and none on an open or only Declined lead", async () => {
    const staff = await signedIn(ADMISSIONS)

    expect(await getLeadClosure(staff, INACTIVE)).toMatchObject({
      ok: true,
      data: { decline: null, closure: { mark: "Inactive", reason: "No longer pursuing admission", closedBy: ADMISSIONS.name } },
    })
    expect(await getLeadClosure(staff, ARCHIVED)).toMatchObject({
      ok: true,
      data: { decline: null, closure: { mark: "Archived", reason: "Family requested closure", closedAt: null, closedBy: null } },
    })
    expect(await getLeadClosure(staff, DECLINED_AND_ARCHIVED)).toMatchObject({
      ok: true,
      data: {
        decline: { reason: "Enrolled elsewhere" },
        closure: { mark: "Archived", reason: "Admission cycle ended", closedBy: MANAGER.name },
      },
    })
    expect(await getLeadClosure(staff, DECLINED)).toMatchObject({ ok: true, data: { closure: null } })
    expect(await getLeadClosure(staff, await newLead())).toEqual({
      ok: true,
      data: { decline: null, closure: null, initiallyDeclined: false, reopenedAfterDecline: null },
    })
  })
})

describe("the history of a mark", () => {
  test("records the mark as one change by the staff member who made it", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()
    await markLead(staff, lead, { mark: "archived", reason: "Record created in error", note: "Entered twice." })

    const history = await getLeadHistory(staff, lead)
    if (!history.ok) throw new Error(`history failed: ${history.error}`)
    const [latest] = history.data.entries
    expect(latest).toMatchObject({ actor: ADMISSIONS.name, record: "lead", action: "update" })
    expect(latest.changes).toEqual(
      expect.arrayContaining([
        { field: "closure", from: null, to: "Archived" },
        { field: "closure_reason", from: null, to: "Record created in error" },
        { field: "closure_note", from: null, to: "Entered twice." },
        { field: "closed_by", from: null, to: ADMISSIONS.id },
      ]),
    )
    expect(latest.changes.map((change) => change.field)).not.toContain("status")
  })
})
