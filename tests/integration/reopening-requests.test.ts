import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { declineLead } from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"
import {
  getLeadReopenings,
  raiseReopeningRequest,
  withdrawReopeningRequest,
  type ReopeningSource,
} from "@/lib/services/reopening-requests"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SECOND_MANAGER } from "../support/fixtures"

// Raising and withdrawing a Reopening request (#99), against local Supabase.
// Each test raises on leads of its own; the seeded ones are only read.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// The seeded Pending request, raised by Test Admissions on ADMSN-90080.
const SEEDED_PENDING_LEAD = "1ead0000-0000-4000-8000-000000000080"

type RequestRow = {
  lead_id: string
  source: ReopeningSource
  reason: string
  state: string
  requested_by: string
  requested_at: Date
  decided_by: string | null
  decided_at: Date | null
}

async function requestsOn(leadId: string): Promise<RequestRow[]> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<RequestRow>(
      `select lead_id, source, reason, state, requested_by, requested_at, decided_by, decided_at
       from public.reopening_requests where lead_id = $1 order by requested_at`,
      [leadId],
    )
    return rows
  })
}

// An open walk-in lead of the test's own: Visited.
async function openLead(): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      // A leading 4 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' numbers.
      contact: { fullName: "Reopen Parent", relationship: "Father", phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Reopen ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  return created.data.leadId
}

async function declinedLead(): Promise<string> {
  const lead = await openLead()
  const declined = await declineLead(await signedIn(ADMISSIONS), lead, { reason: "Family changed plans" })
  if (!declined.ok) throw new Error(`setup failed: ${declined.error}`)
  return lead
}

// An Inactive or Archived lead, marked the way #98's mark_lead would. Once
// #98 adds the closure reason, a mark must carry one in the same statement.
async function markedLead(mark: "Inactive" | "Archived"): Promise<string> {
  const lead = await openLead()
  await asSystem(async (sql) => {
    const { rowCount } = await sql.query(
      "select 1 from information_schema.columns where table_schema = 'public' and table_name = 'leads' and column_name = 'closure_reason'",
    )
    await sql.query(
      rowCount
        ? "update public.leads set closure = $2, closure_reason = 'Family requested closure' where id = $1"
        : "update public.leads set closure = $2 where id = $1",
      [lead, mark],
    )
  })
  return lead
}

async function raised(result: Awaited<ReturnType<typeof raiseReopeningRequest>>): Promise<string> {
  if (!result.ok) throw new Error(`raise failed: ${JSON.stringify(result.error)}`)
  return result.data
}

describe("raising a reopening request", () => {
  test("raises on a Declined, an Inactive and an Archived lead, from each source", async () => {
    const staff = await signedIn(ADMISSIONS)
    const leads = {
      declined: await declinedLead(),
      inactive: await markedLead("Inactive"),
      archived: await markedLead("Archived"),
    }
    const sources: Record<keyof typeof leads, ReopeningSource> = {
      declined: "lead",
      inactive: "duplicate_match",
      archived: "re_application",
    }

    for (const [state, lead] of Object.entries(leads) as [keyof typeof leads, string][]) {
      const result = await raiseReopeningRequest(staff, lead, { reason: "  The family moved back to Dar.  ", source: sources[state] })
      expect(result, state).toEqual({ ok: true, data: expect.any(String) })

      const [row] = await requestsOn(lead)
      expect(row, state).toMatchObject({
        source: sources[state],
        reason: "The family moved back to Dar.",
        state: "pending",
        requested_by: ADMISSIONS.id,
        decided_by: null,
        decided_at: null,
      })
      expect(Date.now() - row.requested_at.getTime(), state).toBeLessThan(60_000)
    }
  })

  test("the Manager may raise one too, holding leads.create and leads.edit", async () => {
    const lead = await declinedLead()
    expect(await raiseReopeningRequest(await signedIn(MANAGER), lead, { reason: "Back after a year.", source: "lead" })).toMatchObject({
      ok: true,
    })
    expect(await requestsOn(lead)).toMatchObject([{ requested_by: MANAGER.id }])
  })

  test("either leads.create or leads.edit is enough", async () => {
    for (const permission of ["leads.create", "leads.edit"]) {
      const lead = await declinedLead()
      const person = await createThrowawayStaff(["leads.view", permission])
      expect(await raiseReopeningRequest(await signedIn(person), lead, { reason: "Back again.", source: "lead" }), permission).toMatchObject({
        ok: true,
      })
    }
  })

  test("refuses an open lead as lead-open, writing nothing", async () => {
    const lead = await openLead()
    expect(await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "Back again.", source: "lead" })).toEqual({
      ok: false,
      error: { kind: "lead-open" },
    })
    expect(await requestsOn(lead)).toEqual([])
  })

  test("refuses a blank or over-long reason and an unknown source", async () => {
    const staff = await signedIn(ADMISSIONS)
    const lead = await declinedLead()

    for (const input of [
      { reason: "", source: "lead" },
      { reason: "   ", source: "lead" },
      { reason: "x".repeat(1001), source: "lead" },
      { reason: "Back again.", source: "admission_form" },
    ] as const) {
      expect(await raiseReopeningRequest(staff, lead, input as { reason: string; source: ReopeningSource }), input.source).toEqual({
        ok: false,
        error: { kind: "invalid" },
      })
    }
    expect(await requestsOn(lead)).toEqual([])
  })

  test("a second request while one is Pending is refused, naming who asked and when", async () => {
    const lead = await declinedLead()
    await raised(await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "First ask.", source: "lead" }))

    const second = await raiseReopeningRequest(await signedIn(MANAGER), lead, { reason: "Second ask.", source: "duplicate_match" })
    expect(second).toEqual({
      ok: false,
      error: { kind: "already-pending", requestedBy: ADMISSIONS.name, requestedAt: expect.any(String) },
    })
    if (second.ok || second.error.kind !== "already-pending") throw new Error("unreachable")
    expect(Date.now() - new Date(second.error.requestedAt!).getTime()).toBeLessThan(60_000)
    expect(await requestsOn(lead)).toHaveLength(1)
  })

  test("two requests raised at once end with one request and one already-pending", async () => {
    const lead = await declinedLead()
    const [one, other] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const results = await Promise.all([
      raiseReopeningRequest(one, lead, { reason: "From the front desk.", source: "duplicate_match" }),
      raiseReopeningRequest(other, lead, { reason: "From the lead screen.", source: "lead" }),
    ])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, error: { kind: "already-pending", requestedBy: expect.any(String), requestedAt: expect.any(String) } },
    ])
    expect(await requestsOn(lead)).toHaveLength(1)
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const id of [randomUUID(), "not-a-lead"]) {
      expect(await raiseReopeningRequest(staff, id, { reason: "Back again.", source: "lead" }), id).toEqual({
        ok: false,
        error: { kind: "not-found" },
      })
    }
  })
})

describe("withdrawing a reopening request", () => {
  test("only the requester may withdraw, and only while it is Pending", async () => {
    const lead = await declinedLead()
    const requester = await signedIn(ADMISSIONS)
    const request = await raised(await raiseReopeningRequest(requester, lead, { reason: "Back again.", source: "lead" }))

    for (const colleague of [MANAGER, SECOND_MANAGER]) {
      expect(await withdrawReopeningRequest(await signedIn(colleague), request), colleague.name).toEqual({
        ok: false,
        error: "not-requester",
      })
    }
    expect(await requestsOn(lead)).toMatchObject([{ state: "pending" }])

    expect(await withdrawReopeningRequest(requester, request)).toEqual({ ok: true, data: null })
    const [row] = await requestsOn(lead)
    expect(row).toMatchObject({ state: "withdrawn", decided_by: ADMISSIONS.id })
    expect(Date.now() - row.decided_at!.getTime()).toBeLessThan(60_000)

    expect(await withdrawReopeningRequest(requester, request)).toEqual({ ok: false, error: "not-pending" })
  })

  test("a new request may be raised after a withdrawal, and both stay on the lead", async () => {
    const lead = await declinedLead()
    const staff = await signedIn(ADMISSIONS)
    const first = await raised(await raiseReopeningRequest(staff, lead, { reason: "First ask.", source: "lead" }))
    await withdrawReopeningRequest(staff, first)

    const manager = await signedIn(MANAGER)
    const second = await raised(await raiseReopeningRequest(manager, lead, { reason: "Second ask.", source: "duplicate_match" }))

    expect(await getLeadReopenings(await signedIn(ACCOUNTANT), lead)).toEqual({
      ok: true,
      data: {
        pending: {
          id: second,
          source: "duplicate_match",
          reason: "Second ask.",
          state: "pending",
          requestedAt: expect.any(String),
          requestedById: MANAGER.id,
          requestedBy: MANAGER.name,
          decidedAt: null,
          decidedBy: null,
          rejectionReason: null,
          enrolWithoutRetake: null,
          leadWasDeclined: null,
          restoredStatus: null,
        },
        decided: [
          {
            id: first,
            source: "lead",
            reason: "First ask.",
            state: "withdrawn",
            requestedAt: expect.any(String),
            requestedById: ADMISSIONS.id,
            requestedBy: ADMISSIONS.name,
            decidedAt: expect.any(String),
            decidedBy: ADMISSIONS.name,
            rejectionReason: null,
            enrolWithoutRetake: null,
            leadWasDeclined: null,
            restoredStatus: null,
          },
        ],
      },
    })
  })

  test("a withdrawn request refuses every change, even from the database owner", async () => {
    const lead = await declinedLead()
    const staff = await signedIn(ADMISSIONS)
    const request = await raised(await raiseReopeningRequest(staff, lead, { reason: "Back again.", source: "lead" }))
    await withdrawReopeningRequest(staff, request)
    const before = await requestsOn(lead)

    for (const change of ["state = 'pending', decided_by = null, decided_at = null", "reason = 'Changed later.'"]) {
      await expect(
        asSystem((sql) => sql.query(`update public.reopening_requests set ${change} where id = $1`, [request])),
        change,
      ).rejects.toThrow("update_refused")
    }
    expect(await requestsOn(lead)).toEqual(before)
  })

  test("a Pending request keeps what was asked, by whom and when", async () => {
    const lead = await declinedLead()
    const request = await raised(await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "Back again.", source: "lead" }))
    await expect(
      asSystem((sql) => sql.query("update public.reopening_requests set reason = 'Rewritten.' where id = $1", [request])),
    ).rejects.toThrow("update_refused")
  })

  test("a request that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await withdrawReopeningRequest(staff, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await withdrawReopeningRequest(staff, "not-a-request")).toEqual({ ok: false, error: "not-found" })
  })
})

describe("who may raise and withdraw", () => {
  test("refuses the Accountant, a role without leads.create or leads.edit, the secret key and visitors who are not signed in", async () => {
    const lead = await declinedLead()
    const viewer = await createThrowawayStaff(["leads.view", "leads.decline", "reopenings.approve"])
    const callers = {
      accountant: await signedIn(ACCOUNTANT),
      viewer: await signedIn(viewer),
      secret: secretClient(),
      anon: anonClient(),
    }

    for (const [who, caller] of Object.entries(callers)) {
      expect(await raiseReopeningRequest(caller, lead, { reason: "Back again.", source: "lead" }), who).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      })
    }
    expect(await requestsOn(lead)).toEqual([])

    const request = await raised(await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "Back again.", source: "lead" }))
    for (const [who, caller] of Object.entries(callers)) {
      expect(await withdrawReopeningRequest(caller, request), who).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await requestsOn(lead)).toMatchObject([{ state: "pending" }])
  })

  test("nobody writes the table directly: not staff, not the secret key", async () => {
    const lead = await declinedLead()
    const row = { lead_id: lead, source: "lead", reason: "Straight in.", requested_by: ADMISSIONS.id }

    for (const [who, caller] of Object.entries({ staff: await signedIn(ADMISSIONS), secret: secretClient(), anon: anonClient() })) {
      const { error } = await caller.from("reopening_requests").insert(row)
      expect(error, who).not.toBeNull()
    }
    expect(await requestsOn(lead)).toEqual([])
  })

  test("deletes are refused, even from the database owner", async () => {
    const lead = await declinedLead()
    const request = await raised(await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "Back again.", source: "lead" }))

    await expect(
      asSystem((sql) => sql.query("delete from public.reopening_requests where id = $1", [request])),
    ).rejects.toThrow("delete_refused")
    // No delete grant for staff either.
    const { error } = await (await signedIn(MANAGER)).from("reopening_requests").delete().eq("id", request)
    expect(error).not.toBeNull()
    expect(await requestsOn(lead)).toHaveLength(1)
  })
})

describe("reading a lead's requests", () => {
  test("staff who may view leads read them; visitors who are not signed in see nothing", async () => {
    const lead = await declinedLead()
    await raised(await raiseReopeningRequest(await signedIn(ADMISSIONS), lead, { reason: "Back again.", source: "lead" }))

    const { data: asAccountant } = await (await signedIn(ACCOUNTANT)).from("reopening_requests").select("id").eq("lead_id", lead)
    expect(asAccountant).toHaveLength(1)

    const { data: asAnon } = await anonClient().from("reopening_requests").select("id").eq("lead_id", lead)
    expect(asAnon ?? []).toEqual([])
    expect(await getLeadReopenings(anonClient(), lead)).toEqual({ ok: false, error: "forbidden" })
  })

  test("an open lead with no requests has none, and a missing lead is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getLeadReopenings(staff, await openLead())).toEqual({ ok: true, data: { pending: null, decided: [] } })
    expect(await getLeadReopenings(staff, randomUUID())).toEqual({ ok: false, error: "not-found" })
  })

  test("the seeded Pending request was raised by Test Admissions", async () => {
    expect(await getLeadReopenings(await signedIn(MANAGER), SEEDED_PENDING_LEAD)).toMatchObject({
      ok: true,
      data: { pending: { state: "pending", requestedBy: ADMISSIONS.name, requestedById: ADMISSIONS.id } },
    })
  })
})

describe("the history of a request", () => {
  test("records raising and withdrawing, each by the staff member who did it", async () => {
    const lead = await declinedLead()
    const staff = await signedIn(ADMISSIONS)
    const request = await raised(await raiseReopeningRequest(staff, lead, { reason: "The family is back.", source: "lead" }))
    await withdrawReopeningRequest(staff, request)

    const history = await getLeadHistory(staff, lead)
    if (!history.ok) throw new Error(`history failed: ${history.error}`)
    const entries = history.data.entries.filter((entry) => entry.record === "reopening_requests")
    expect(entries).toEqual([
      expect.objectContaining({
        actor: ADMISSIONS.name,
        recordId: request,
        action: "update",
        changes: expect.arrayContaining([{ field: "state", from: "pending", to: "withdrawn" }]),
      }),
      expect.objectContaining({
        actor: ADMISSIONS.name,
        recordId: request,
        action: "insert",
        changes: expect.arrayContaining([
          { field: "reason", from: null, to: "The family is back." },
          { field: "source", from: null, to: "lead" },
          { field: "state", from: null, to: "pending" },
        ]),
      }),
    ])
  })
})
