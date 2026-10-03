import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { DECLINED_REASONS, declineLead, getLeadClosure, type DeclinedReason } from "@/lib/services/lead-closure"
import { createLead, updateLeadDetails, type LeadStatus } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Declining a lead through the lead closure module (#97), against local
// Supabase. Each test declines leads of its own; the seeded ones are only
// read or refused.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// Slice 2's seeded closed leads, and slice 8's lead declined after its
// interview.
const ARCHIVED = "1ead0000-0000-4000-8000-000000000005"
const DECLINED = "1ead0000-0000-4000-8000-000000000006"
const DECLINED_FROM_INTERVIEWED = "1ead0000-0000-4000-8000-000000000082"

type DeclineRow = {
  status: LeadStatus
  declined_reason: DeclinedReason | null
  declined_explanation: string | null
  declined_at: Date | null
  declined_by: string | null
  status_before_decline: LeadStatus | null
}

async function read(leadId: string): Promise<DeclineRow> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<DeclineRow>(
      `select status, declined_reason, declined_explanation, declined_at, declined_by, status_before_decline
       from public.leads where id = $1`,
      [leadId],
    )
    return rows[0]
  })
}

// A lead of the test's own: a walk-in (Visited) by default, or Applied from
// the Admission form.
async function newLead(start: "walk-in" | "admission-form" = "walk-in"): Promise<string> {
  const creator = start === "walk-in" ? await signedIn(ADMISSIONS) : secretClient()
  const created = await createLead(creator, {
    guardian: {
      // A leading 5 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' numbers.
      contact: { fullName: "Decline Parent", relationship: "Mother", phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Decline ${randomUUID().slice(0, 8)}`, className: "STD 4", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: start === "walk-in" ? { kind: "walk-in", visitDate: today } : { kind: "admission-form" },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

// Moves a lead on the way a later slice's function would, as the system.
async function setStatus(leadId: string, status: LeadStatus) {
  await asSystem((sql) => sql.query("update public.leads set status = $2 where id = $1", [leadId, status]))
}

describe("declining a lead", () => {
  test("declines with every reason, remembering the status before, who and when", async () => {
    const manager = await signedIn(MANAGER)
    const leads = await Promise.all(DECLINED_REASONS.map(() => newLead()))

    for (const [i, reason] of DECLINED_REASONS.entries()) {
      const explanation = reason === "Other" ? "Moving abroad with the family." : undefined
      expect(await declineLead(manager, leads[i], { reason, explanation }), reason).toEqual({ ok: true, data: null })

      const row = await read(leads[i])
      expect(row, reason).toMatchObject({
        status: "Declined",
        declined_reason: reason,
        declined_explanation: explanation ?? null,
        declined_by: MANAGER.id,
        status_before_decline: "Visited",
      })
      expect(Date.now() - row.declined_at!.getTime(), reason).toBeLessThan(60_000)
    }
  })

  test("keeps an optional explanation, trimmed, and treats a blank one as none", async () => {
    const staff = await signedIn(ADMISSIONS)
    const [explained, blank] = await Promise.all([newLead(), newLead()])

    await declineLead(staff, explained, { reason: "Fees or cost", explanation: "  Fees too high this year.  " })
    await declineLead(staff, blank, { reason: "Fees or cost", explanation: "   " })

    expect(await read(explained)).toMatchObject({ declined_explanation: "Fees too high this year.", declined_by: ADMISSIONS.id })
    expect(await read(blank)).toMatchObject({ status: "Declined", declined_explanation: null })
  })

  test("refuses Other without an explanation, an unknown reason and an over-long explanation, changing nothing", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()
    const before = await read(lead)

    expect(await declineLead(staff, lead, { reason: "Other" })).toEqual({ ok: false, error: "invalid" })
    expect(await declineLead(staff, lead, { reason: "Other", explanation: "  " })).toEqual({ ok: false, error: "invalid" })
    expect(await declineLead(staff, lead, { reason: "Bored" as DeclinedReason })).toEqual({ ok: false, error: "invalid" })
    expect(await declineLead(staff, lead, { reason: "Fees or cost", explanation: "x".repeat(1001) })).toEqual({
      ok: false,
      error: "invalid",
    })
    expect(await read(lead)).toEqual(before)
  })

  test("declines from every status, Enrolled included, and remembers which", async () => {
    const staff = await signedIn(ADMISSIONS)
    const applied = await newLead("admission-form")
    const [interviewed, enrolled] = await Promise.all([newLead(), newLead()])
    await setStatus(interviewed, "Interviewed")
    await setStatus(enrolled, "Enrolled")

    for (const [lead, status] of [
      [applied, "Applied"],
      [interviewed, "Interviewed"],
      [enrolled, "Enrolled"],
    ] as const) {
      expect(await declineLead(staff, lead, { reason: "Family changed plans" }), status).toEqual({ ok: true, data: null })
      expect(await read(lead), status).toMatchObject({ status: "Declined", status_before_decline: status })
    }
  })

  test("refuses a lead that is already Declined or carries a closure mark", async () => {
    const manager = await signedIn(MANAGER)
    const lead = await newLead()
    await declineLead(manager, lead, { reason: "School decision" })
    const declinedOnce = await read(lead)

    expect(await declineLead(manager, lead, { reason: "Fees or cost" })).toEqual({ ok: false, error: "lead-closed" })
    expect(await read(lead)).toEqual(declinedOnce)
    expect(await declineLead(manager, DECLINED, { reason: "Fees or cost" })).toEqual({ ok: false, error: "lead-closed" })
    const archived = await read(ARCHIVED)
    expect(await declineLead(manager, ARCHIVED, { reason: "Fees or cost" })).toEqual({ ok: false, error: "lead-closed" })
    expect(await read(ARCHIVED)).toEqual(archived)
  })

  test("two staff declining the same lead at once decline it once", async () => {
    const lead = await newLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      declineLead(one, lead, { reason: "Fees or cost" }),
      declineLead(other, lead, { reason: "School decision" }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([{ ok: false, error: "lead-closed" }])
  })

  test("a Declined lead is then read-only", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()
    await declineLead(staff, lead, { reason: "Enrolled elsewhere" })

    expect(await updateLeadDetails(staff, lead, { className: "STD 5" })).toEqual({ ok: false, error: { kind: "closed" } })
    await expect(
      asSystem((sql) => sql.query("update public.leads set declined_reason = 'Fees or cost' where id = $1", [lead])),
    ).rejects.toThrow("lead_closed")
  })

  test("runs inside the caller's transaction, and is undone with it", async () => {
    const lead = await newLead()

    const inside = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [ADMISSIONS.id])
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: rows[0].user_id, role: "authenticated" }),
      ])
      await sql.query("set local role authenticated")
      await sql.query("select public.decline_lead($1, 'Fees or cost', null)", [lead])
      return (await sql.query<{ status: LeadStatus }>("select status from public.leads where id = $1", [lead])).rows[0].status
    })

    expect(inside).toBe("Declined")
    expect(await read(lead)).toMatchObject({ status: "Visited", declined_reason: null })
  })

  test("the database keeps a Declined lead's reason, and Other's explanation", async () => {
    const lead = await newLead()
    for (const change of [
      "status = 'Declined'",
      "status = 'Declined', declined_reason = 'Other'",
      "declined_reason = 'Fees or cost'",
    ]) {
      await expect(
        asSystem((sql) => sql.query(`update public.leads set ${change} where id = $1`, [lead])),
        change,
      ).rejects.toThrow(/check constraint/)
    }
  })
})

describe("who may decline", () => {
  test("No seat available needs academic_years.manage: Admissions Staff are refused, the Manager is not", async () => {
    const [refused, allowed] = await Promise.all([newLead(), newLead()])

    expect(await declineLead(await signedIn(ADMISSIONS), refused, { reason: "No seat available" })).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await read(refused)).toMatchObject({ status: "Visited", declined_reason: null })
    expect(await declineLead(await signedIn(MANAGER), allowed, { reason: "No seat available" })).toEqual({ ok: true, data: null })
  })

  test("refuses the Accountant, a role without leads.decline, the secret key and visitors who are not signed in", async () => {
    const lead = await newLead()
    const viewer = await createThrowawayStaff(["leads.view", "leads.edit", "academic_years.manage"])
    const callers = {
      accountant: await signedIn(ACCOUNTANT),
      viewer: await signedIn(viewer),
      secret: secretClient(),
      anon: anonClient(),
    }

    for (const [who, caller] of Object.entries(callers)) {
      expect(await declineLead(caller, lead, { reason: "School decision" }), who).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await read(lead)).toMatchObject({ status: "Visited", declined_reason: null })
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await declineLead(staff, randomUUID(), { reason: "School decision" })).toEqual({ ok: false, error: "not-found" })
    expect(await declineLead(staff, "not-a-lead", { reason: "School decision" })).toEqual({ ok: false, error: "not-found" })
  })
})

describe("reading a lead's decline", () => {
  test("names the reason, explanation, who, when and the status before, for anyone who may view leads", async () => {
    const lead = await newLead()
    await declineLead(await signedIn(ADMISSIONS), lead, { reason: "Other", explanation: "Moving to Arusha." })

    const closure = await getLeadClosure(await signedIn(ACCOUNTANT), lead)
    expect(closure).toEqual({
      ok: true,
      data: {
        decline: {
          reason: "Other",
          explanation: "Moving to Arusha.",
          declinedAt: expect.any(String),
          declinedBy: ADMISSIONS.name,
          statusBefore: "Visited",
        },
      },
    })
  })

  test("reads the seeded declines, and none on an open or only Archived lead", async () => {
    const staff = await signedIn(ADMISSIONS)

    expect(await getLeadClosure(staff, DECLINED_FROM_INTERVIEWED)).toMatchObject({
      ok: true,
      data: { decline: { reason: "Did not pass interview", declinedBy: ADMISSIONS.name, statusBefore: "Interviewed" } },
    })
    expect(await getLeadClosure(staff, DECLINED)).toMatchObject({
      ok: true,
      data: { decline: { reason: "Family changed plans", declinedAt: null, declinedBy: null } },
    })
    expect(await getLeadClosure(staff, ARCHIVED)).toEqual({ ok: true, data: { decline: null } })
    expect(await getLeadClosure(staff, await newLead())).toEqual({ ok: true, data: { decline: null } })
  })

  test("is refused to visitors who are not signed in, and a missing lead is not found", async () => {
    expect(await getLeadClosure(anonClient(), DECLINED)).toEqual({ ok: false, error: "forbidden" })
    expect(await getLeadClosure(await signedIn(ADMISSIONS), randomUUID())).toEqual({ ok: false, error: "not-found" })
  })
})

describe("the history of a decline", () => {
  test("records the decline as one change by the staff member who made it", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await newLead()
    await declineLead(staff, lead, { reason: "Unreachable after follow-up", explanation: "No answer for three weeks." })

    const history = await getLeadHistory(staff, lead)
    if (!history.ok) throw new Error(`history failed: ${history.error}`)
    const [latest] = history.data.entries
    expect(latest).toMatchObject({ actor: ADMISSIONS.name, record: "lead", action: "update" })
    expect(latest.changes).toEqual(
      expect.arrayContaining([
        { field: "status", from: "Visited", to: "Declined" },
        { field: "declined_reason", from: null, to: "Unreachable after follow-up" },
        { field: "declined_explanation", from: null, to: "No answer for three weeks." },
        { field: "status_before_decline", from: null, to: "Visited" },
        { field: "declined_by", from: null, to: ADMISSIONS.id },
      ]),
    )
  })
})
