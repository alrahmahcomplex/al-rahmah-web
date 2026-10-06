import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  approveReopeningRequest,
  declineLead,
  getLeadClosure,
  markLead,
  rejectReopeningRequest,
} from "@/lib/services/lead-closure"
import { createLead, getLead, type LeadStatus } from "@/lib/services/leads"
import { getLeadReopenings, raiseReopeningRequest, withdrawReopeningRequest } from "@/lib/services/reopening-requests"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SECOND_MANAGER, type FixtureStaff } from "../support/fixtures"

// Approving and rejecting a Reopening request (#101), through the lead
// closure module against local Supabase, signed in as each seeded role. Each
// test decides requests on leads of its own.

const today = tanzaniaToday()
const thisYear = Number(today.slice(0, 4))

// An open walk-in lead of the test's own, Visited, or moved to `status` the
// way its own slice would have.
async function openLead(status: Exclude<LeadStatus, "Declined"> = "Visited"): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      // A leading 3 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' numbers.
      contact: { fullName: "Decide Parent", relationship: "Mother", phone: `03${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Decide ${randomUUID().slice(0, 8)}`, className: "STD 3", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: today },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  if (status !== "Visited") {
    await asSystem((sql) =>
      sql.query(
        status === "Applied"
          ? "update public.leads set status = 'Applied', visit_date = null where id = $1"
          : "update public.leads set status = $2 where id = $1",
        status === "Applied" ? [id] : [id, status],
      ),
    )
  }
  return id
}

async function declined(status: Exclude<LeadStatus, "Declined"> = "Visited"): Promise<string> {
  const lead = await openLead(status)
  const result = await declineLead(await signedIn(MANAGER), lead, { reason: "Family changed plans" })
  if (!result.ok) throw new Error(`decline failed: ${result.error}`)
  return lead
}

async function marked(lead: string, mark: "inactive" | "archived"): Promise<string> {
  const result = await markLead(await signedIn(MANAGER), lead, { mark, reason: "Family requested closure", note: "They will call." })
  if (!result.ok) throw new Error(`mark failed: ${result.error}`)
  return lead
}

async function requested(lead: string, by: FixtureStaff = ADMISSIONS): Promise<string> {
  const result = await raiseReopeningRequest(await signedIn(by), lead, { reason: "The family is back.", source: "lead" })
  if (!result.ok) throw new Error(`raise failed: ${JSON.stringify(result.error)}`)
  return result.data
}

type LeadRow = {
  status: LeadStatus
  closure: string | null
  declined_reason: string | null
  declined_at: Date | null
  declined_by: string | null
  status_before_decline: string | null
  closure_reason: string | null
  closure_note: string | null
  closed_at: Date | null
  closed_by: string | null
  initially_declined: boolean
}

async function leadRow(id: string): Promise<LeadRow> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<LeadRow>(
      `select status, closure, declined_reason, declined_at, declined_by, status_before_decline,
              closure_reason, closure_note, closed_at, closed_by, initially_declined
       from public.leads where id = $1`,
      [id],
    )
    return rows[0]
  })
}

async function requestRow(id: string) {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query(
      `select state, requested_by, decided_by, decided_at, rejection_reason, enrol_without_retake, lead_was_declined, restored_status
       from public.reopening_requests where id = $1`,
      [id],
    )
    return rows[0]
  })
}

const CLEARED_DECLINE = { declined_reason: null, declined_at: null, declined_by: null, status_before_decline: null }
const CLEARED_MARK = { closure: null, closure_reason: null, closure_note: null, closed_at: null, closed_by: null }

describe("approving a reopening request", () => {
  test("a Declined lead goes back to the status it held before, and keeps the Initially declined tag", async () => {
    const manager = await signedIn(MANAGER)
    for (const before of ["Applied", "Visited"] as const) {
      const lead = await declined(before)
      const request = await requested(lead)

      expect(await approveReopeningRequest(manager, request), before).toEqual({ ok: true, data: null })
      expect(await leadRow(lead), before).toMatchObject({ status: before, initially_declined: true, ...CLEARED_DECLINE, ...CLEARED_MARK })
      expect(await requestRow(request), before).toMatchObject({
        state: "approved",
        decided_by: MANAGER.id,
        enrol_without_retake: null,
        lead_was_declined: true,
        restored_status: before,
      })
    }
  })

  test("a lead declined from Interviewed comes back Interviewed, with the retake choice recorded", async () => {
    const manager = await signedIn(MANAGER)
    for (const enrolWithoutRetake of [false, true]) {
      const lead = await declined("Interviewed")
      const request = await requested(lead)

      expect(await approveReopeningRequest(manager, request, { enrolWithoutRetake })).toEqual({ ok: true, data: null })
      expect(await leadRow(lead)).toMatchObject({ status: "Interviewed", initially_declined: true })
      expect(await requestRow(request)).toMatchObject({ enrol_without_retake: enrolWithoutRetake, restored_status: "Interviewed" })
    }
  })

  test("a lead declined while Enrolled comes back as Interviewed, never Enrolled", async () => {
    const lead = await declined("Enrolled")
    const request = await requested(lead)

    expect(await approveReopeningRequest(await signedIn(MANAGER), request, { enrolWithoutRetake: true })).toEqual({ ok: true, data: null })
    expect(await leadRow(lead)).toMatchObject({ status: "Interviewed", initially_declined: true, ...CLEARED_DECLINE })
    expect(await requestRow(request)).toMatchObject({ lead_was_declined: true, restored_status: "Interviewed", enrol_without_retake: true })
  })

  test("a lead declined before declines recorded the earlier status goes back to Visited", async () => {
    const lead = await openLead()
    await asSystem((sql) =>
      sql.query("update public.leads set status = 'Declined', declined_reason = 'Fees or cost' where id = $1", [lead]),
    )
    const request = await requested(lead)

    expect(await approveReopeningRequest(await signedIn(MANAGER), request)).toEqual({ ok: true, data: null })
    expect(await leadRow(lead)).toMatchObject({ status: "Visited", initially_declined: true, ...CLEARED_DECLINE })
    expect(await requestRow(request)).toMatchObject({ lead_was_declined: true, restored_status: "Visited" })
  })

  test("an Inactive or Archived lead loses its mark and keeps its status, without the tag", async () => {
    const manager = await signedIn(MANAGER)
    for (const mark of ["inactive", "archived"] as const) {
      const lead = await marked(await openLead("Interviewed"), mark)
      const request = await requested(lead)

      expect(await approveReopeningRequest(manager, request), mark).toEqual({ ok: true, data: null })
      expect(await leadRow(lead), mark).toMatchObject({ status: "Interviewed", initially_declined: false, ...CLEARED_MARK })
      expect(await requestRow(request), mark).toMatchObject({ lead_was_declined: false, restored_status: "Interviewed" })
    }
  })

  test("one approval fully reopens a lead both Declined and Archived", async () => {
    const lead = await marked(await declined("Visited"), "archived")
    const request = await requested(lead)

    expect(await approveReopeningRequest(await signedIn(MANAGER), request)).toEqual({ ok: true, data: null })
    expect(await leadRow(lead)).toMatchObject({ status: "Visited", initially_declined: true, ...CLEARED_DECLINE, ...CLEARED_MARK })
    const reopened = await getLead(await signedIn(ADMISSIONS), lead)
    expect(reopened).toMatchObject({ ok: true, data: { status: "Visited", closure: null, initiallyDeclined: true } })
  })

  test("the retake choice is required after an interview, and refused before one", async () => {
    const manager = await signedIn(MANAGER)

    for (const before of ["Interviewed", "Enrolled"] as const) {
      const request = await requested(await declined(before))
      expect(await approveReopeningRequest(manager, request), before).toEqual({ ok: false, error: "invalid" })
      expect(await requestRow(request), before).toMatchObject({ state: "pending" })
    }

    const visited = await requested(await declined("Visited"))
    expect(await approveReopeningRequest(manager, visited, { enrolWithoutRetake: true })).toEqual({ ok: false, error: "invalid" })
    expect(await requestRow(visited)).toMatchObject({ state: "pending" })

    // A mark alone was no decline, whatever the status.
    const inactive = await requested(await marked(await openLead("Interviewed"), "inactive"))
    expect(await approveReopeningRequest(manager, inactive, { enrolWithoutRetake: false })).toEqual({ ok: false, error: "invalid" })
    expect(await requestRow(inactive)).toMatchObject({ state: "pending" })
  })

  test("a Manager approves their own request, recorded as raised and approved by them", async () => {
    const lead = await declined()
    const request = await requested(lead, MANAGER)

    expect(await approveReopeningRequest(await signedIn(MANAGER), request)).toEqual({ ok: true, data: null })
    expect(await requestRow(request)).toMatchObject({ state: "approved", requested_by: MANAGER.id, decided_by: MANAGER.id })
  })

  test("the tag stays after a later decline, and the closure reads the Reopened after decline note", async () => {
    const lead = await declined()
    const request = await requested(lead)
    expect(await approveReopeningRequest(await signedIn(MANAGER), request)).toMatchObject({ ok: true })

    const reader = await signedIn(ACCOUNTANT)
    const closure = await getLeadClosure(reader, lead)
    expect(closure).toMatchObject({
      ok: true,
      data: {
        decline: null,
        closure: null,
        initiallyDeclined: true,
        reopenedAfterDecline: { approvedBy: MANAGER.name, restoredStatus: "Visited", enrolWithoutRetake: null },
      },
    })
    if (!closure.ok || !closure.data.reopenedAfterDecline) throw new Error("no note")
    expect(Date.now() - new Date(closure.data.reopenedAfterDecline.reopenedAt).getTime()).toBeLessThan(60_000)

    expect(await declineLead(await signedIn(ADMISSIONS), lead, { reason: "Fees or cost" })).toEqual({ ok: true, data: null })
    expect(await leadRow(lead)).toMatchObject({ status: "Declined", initially_declined: true })
    expect(await getLeadClosure(reader, lead)).toMatchObject({ ok: true, data: { initiallyDeclined: true } })

    // Nobody clears it, not even the database owner.
    await expect(
      asSystem((sql) => sql.query("update public.leads set initially_declined = false where id = $1", [lead])),
    ).rejects.toThrow("update_refused")
  })

  test("a lead reopened from a mark alone has no Reopened after decline note", async () => {
    const lead = await marked(await openLead(), "inactive")
    await approveReopeningRequest(await signedIn(MANAGER), await requested(lead))
    expect(await getLeadClosure(await signedIn(MANAGER), lead)).toMatchObject({
      ok: true,
      data: { initiallyDeclined: false, reopenedAfterDecline: null },
    })
  })
})

describe("rejecting a reopening request", () => {
  test("needs a written reason, keeps the lead closed, and the requester reads the reason", async () => {
    const lead = await declined()
    const request = await requested(lead)
    const manager = await signedIn(MANAGER)

    expect(await rejectReopeningRequest(manager, request, { reason: "   " })).toEqual({ ok: false, error: "invalid" })
    expect(await rejectReopeningRequest(manager, request, { reason: "x".repeat(1001) })).toEqual({ ok: false, error: "invalid" })
    expect(await requestRow(request)).toMatchObject({ state: "pending" })

    expect(await rejectReopeningRequest(manager, request, { reason: "  No places left this year.  " })).toEqual({ ok: true, data: null })
    expect(await requestRow(request)).toMatchObject({
      state: "rejected",
      decided_by: MANAGER.id,
      rejection_reason: "No places left this year.",
      lead_was_declined: null,
      restored_status: null,
    })
    expect(await leadRow(lead)).toMatchObject({ status: "Declined", initially_declined: false })

    const seen = await getLeadReopenings(await signedIn(ADMISSIONS), lead)
    expect(seen).toMatchObject({
      ok: true,
      data: {
        pending: null,
        decided: [{ state: "rejected", decidedBy: MANAGER.name, rejectionReason: "No places left this year." }],
      },
    })
  })
})

describe("a decided request", () => {
  test("refuses any other decision or a withdrawal, and takes the same decision again as done", async () => {
    const approvedLead = await declined("Interviewed")
    const approved = await requested(approvedLead)
    const manager = await signedIn(MANAGER)
    expect(await approveReopeningRequest(manager, approved, { enrolWithoutRetake: false })).toMatchObject({ ok: true })
    const after = await requestRow(approved)

    // A retried click: the same approver, the same answer.
    expect(await approveReopeningRequest(manager, approved, { enrolWithoutRetake: false })).toEqual({ ok: true, data: null })
    expect(await requestRow(approved)).toEqual(after)

    expect(await approveReopeningRequest(manager, approved, { enrolWithoutRetake: true })).toEqual({ ok: false, error: "not-pending" })
    expect(await approveReopeningRequest(await signedIn(SECOND_MANAGER), approved, { enrolWithoutRetake: false })).toEqual({
      ok: false,
      error: "not-pending",
    })
    expect(await rejectReopeningRequest(manager, approved, { reason: "Changed my mind." })).toEqual({ ok: false, error: "not-pending" })
    expect(await withdrawReopeningRequest(await signedIn(ADMISSIONS), approved)).toEqual({ ok: false, error: "not-pending" })
    expect(await requestRow(approved)).toEqual(after)

    const rejected = await requested(await declined())
    expect(await rejectReopeningRequest(manager, rejected, { reason: "Not this year." })).toMatchObject({ ok: true })
    expect(await rejectReopeningRequest(manager, rejected, { reason: "Not this year." })).toEqual({ ok: true, data: null })
    expect(await rejectReopeningRequest(manager, rejected, { reason: "Another reason." })).toEqual({ ok: false, error: "not-pending" })
    expect(await approveReopeningRequest(manager, rejected)).toEqual({ ok: false, error: "not-pending" })

    const withdrawn = await requested(await declined())
    expect(await withdrawReopeningRequest(await signedIn(ADMISSIONS), withdrawn)).toMatchObject({ ok: true })
    expect(await approveReopeningRequest(manager, withdrawn)).toEqual({ ok: false, error: "not-pending" })
    expect(await rejectReopeningRequest(manager, withdrawn, { reason: "Too late." })).toEqual({ ok: false, error: "not-pending" })

    // Nor can the database owner change a decided request.
    await expect(
      asSystem((sql) => sql.query("update public.reopening_requests set rejection_reason = 'x' where id = $1", [rejected])),
    ).rejects.toThrow("update_refused")
  })

  test("an unknown or malformed request is not found", async () => {
    const manager = await signedIn(MANAGER)
    expect(await approveReopeningRequest(manager, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await rejectReopeningRequest(manager, "not-a-uuid", { reason: "No." })).toEqual({ ok: false, error: "not-found" })
  })
})

describe("who may decide", () => {
  test("only staff with reopenings.approve; Admissions Staff, the Accountant and visitors are refused", async () => {
    const lead = await declined()
    const request = await requested(lead)

    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      const staff = await signedIn(person)
      expect(await approveReopeningRequest(staff, request), person.name).toEqual({ ok: false, error: "forbidden" })
      expect(await rejectReopeningRequest(staff, request, { reason: "No." }), person.name).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await approveReopeningRequest(anonClient(), request)).toEqual({ ok: false, error: "forbidden" })
    expect(await rejectReopeningRequest(anonClient(), request, { reason: "No." })).toEqual({ ok: false, error: "forbidden" })
    expect(await requestRow(request)).toMatchObject({ state: "pending" })

    // The permission alone is enough, without any other.
    const approver = await createThrowawayStaff(["leads.view", "reopenings.approve"])
    expect(await approveReopeningRequest(await signedIn(approver), request)).toEqual({ ok: true, data: null })
    expect(await requestRow(request)).toMatchObject({ state: "approved", decided_by: approver.id })
  })
})

describe("the history", () => {
  test("shows the reopening on the lead and each decision on its request, under the approver", async () => {
    const lead = await marked(await declined("Visited"), "archived")
    const rejected = await requested(lead)
    const manager = await signedIn(MANAGER)
    await rejectReopeningRequest(manager, rejected, { reason: "Ask again in January." })
    const approved = await requested(lead)
    await approveReopeningRequest(manager, approved)

    const history = await getLeadHistory(manager, lead)
    if (!history.ok) throw new Error(history.error)
    const entries = history.data.entries

    const rejection = entries.find((e) => e.recordId === rejected && e.action === "update")
    expect(rejection).toMatchObject({ actor: MANAGER.name, record: "reopening_requests" })
    expect(rejection?.changes).toEqual(
      expect.arrayContaining([
        { field: "state", from: "pending", to: "rejected" },
        { field: "rejection_reason", from: null, to: "Ask again in January." },
      ]),
    )

    const approval = entries.find((e) => e.recordId === approved && e.action === "update")
    expect(approval).toMatchObject({ actor: MANAGER.name })
    expect(approval?.changes).toEqual(
      expect.arrayContaining([
        { field: "state", from: "pending", to: "approved" },
        { field: "lead_was_declined", from: null, to: true },
        { field: "restored_status", from: null, to: "Visited" },
      ]),
    )

    const reopening = entries.find(
      (e) => e.record === "lead" && e.changes.some((c) => c.field === "status" && c.from === "Declined"),
    )
    expect(reopening).toMatchObject({ actor: MANAGER.name })
    expect(reopening?.changes).toEqual(
      expect.arrayContaining([
        { field: "status", from: "Declined", to: "Visited" },
        { field: "closure", from: "Archived", to: null },
        { field: "initially_declined", from: false, to: true },
      ]),
    )
  })
})
