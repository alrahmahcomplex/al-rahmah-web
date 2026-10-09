import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  approveReopeningRequest,
  countPendingReopeningRequests,
  declineLead,
  listPendingReopeningRequests,
  markLead,
  rejectReopeningRequest,
} from "@/lib/services/lead-closure"
import { createLead } from "@/lib/services/leads"
import { raiseReopeningRequest, withdrawReopeningRequest, type PendingReopeningRequest } from "@/lib/services/reopening-requests"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, lockExclusively, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The Reopening requests queue and its count (#100), against local Supabase.
// Each test raises on leads of its own; other files raise and decide
// requests meanwhile, so a test checks its own rows, never the whole list.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// The seeded Pending request, raised by Test Admissions on ADMSN-90080.
const SEEDED_PENDING = "5e0e0000-0000-4000-8000-000000000080"

async function declinedLead(): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: {
      // A leading 4 keeps it clear of the seeded 700 000 numbers.
      contact: { fullName: "Queue Parent", relationship: "Mother", phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Queue ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const declined = await declineLead(admissions, created.data.leadId, { reason: "Family changed plans" })
  if (!declined.ok) throw new Error(`setup failed: ${declined.error}`)
  return created.data.leadId
}

async function raise(leadId: string, reason = "The family is back."): Promise<string> {
  const result = await raiseReopeningRequest(await signedIn(ADMISSIONS), leadId, { reason, source: "lead" })
  if (!result.ok) throw new Error(`raise failed: ${JSON.stringify(result.error)}`)
  return result.data
}

async function queue(): Promise<PendingReopeningRequest[]> {
  const listed = await listPendingReopeningRequests(await signedIn(MANAGER))
  if (!listed.ok) throw new Error(listed.error)
  return listed.data
}

describe("the Reopening requests queue", () => {
  test("lists Pending requests oldest first, with the lead, the requester, the source and the reason", async () => {
    const first = await declinedLead()
    const second = await declinedLead()
    // Archived as well as Declined: the row shows both.
    const marked = await markLead(await signedIn(MANAGER), second, { mark: "archived", reason: "Admission cycle ended" })
    if (!marked.ok) throw new Error(`setup failed: ${marked.error}`)
    const older = await raise(first, "The family moved back to Dar.")
    const newer = await raise(second, "  A new reason.  ")

    const listed = await queue()
    const ids = listed.map((request) => request.id)
    expect(ids.indexOf(older)).toBeGreaterThanOrEqual(0)
    expect(ids.indexOf(older)).toBeLessThan(ids.indexOf(newer))
    const times = listed.map((request) => Date.parse(request.requestedAt))
    expect(times).toEqual(times.toSorted((a, b) => a - b))

    expect(listed.find((request) => request.id === newer)).toMatchObject({
      leadId: second,
      status: "Declined",
      closure: "Archived",
      source: "lead",
      reason: "A new reason.",
      requestedBy: ADMISSIONS.name,
    })
    expect(listed.find((request) => request.id === SEEDED_PENDING)).toMatchObject({
      admissionNumber: "ADMSN-90080",
      studentName: "Asha Kibwana",
      status: "Declined",
      closure: null,
      source: "lead",
      requestedBy: ADMISSIONS.name,
      requestedAt: expect.any(String),
    })
  })

  test("leaves out approved, rejected and withdrawn requests", async () => {
    const manager = await signedIn(MANAGER)
    const approved = await raise(await declinedLead())
    const rejected = await raise(await declinedLead())
    const withdrawn = await raise(await declinedLead())
    const stillPending = await raise(await declinedLead())

    expect((await approveReopeningRequest(manager, approved)).ok).toBe(true)
    expect((await rejectReopeningRequest(manager, rejected, { reason: "Places are filled." })).ok).toBe(true)
    expect((await withdrawReopeningRequest(await signedIn(ADMISSIONS), withdrawn)).ok).toBe(true)

    const ids = (await queue()).map((request) => request.id)
    expect(ids).toContain(stillPending)
    expect(ids).not.toContain(approved)
    expect(ids).not.toContain(rejected)
    expect(ids).not.toContain(withdrawn)
  })

  test("the count is how many requests are Pending, and follows a new request and a decision", async () => {
    const manager = await signedIn(MANAGER)
    const pendingNow = () =>
      inRolledBackTransaction(async (sql) => {
        // No request may be raised or decided meanwhile, so the three
        // readings agree.
        await lockExclusively(sql, ["public.reopening_requests"])
        const counted = await countPendingReopeningRequests(manager)
        const listed = await listPendingReopeningRequests(manager)
        const { rows } = await sql.query<{ n: number }>(
          "select count(*)::int as n from public.reopening_requests where state = 'pending'",
        )
        expect(counted).toEqual({ ok: true, data: rows[0].n })
        expect(listed.ok && listed.data.length).toBe(rows[0].n)
        return rows[0].n
      })

    expect(await pendingNow()).toBeGreaterThanOrEqual(1)
    const request = await raise(await declinedLead())
    await pendingNow()
    expect((await rejectReopeningRequest(manager, request, { reason: "Not this year." })).ok).toBe(true)
    await pendingNow()
  })

  test("is refused to Admissions Staff, the Accountant, an approver without leads.view and anyone signed out", async () => {
    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      const client = await signedIn(person)
      expect(await listPendingReopeningRequests(client), person.name).toEqual({ ok: false, error: "forbidden" })
      expect(await countPendingReopeningRequests(client), person.name).toEqual({ ok: false, error: "forbidden" })
    }
    // An approver who may not view leads couldn't open any of them to decide.
    const approverOnly = await signedIn(await createThrowawayStaff(["reopenings.approve"]))
    expect(await listPendingReopeningRequests(approverOnly)).toEqual({ ok: false, error: "forbidden" })
    expect(await countPendingReopeningRequests(approverOnly)).toEqual({ ok: false, error: "forbidden" })

    const anon = anonClient()
    expect(await listPendingReopeningRequests(anon)).toEqual({ ok: false, error: "forbidden" })
    expect(await countPendingReopeningRequests(anon)).toEqual({ ok: false, error: "forbidden" })
  })
})
