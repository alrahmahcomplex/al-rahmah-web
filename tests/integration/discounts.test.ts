import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import {
  decideDiscount,
  getLeadDiscounts,
  listPendingDiscountRequests,
  requestDiscount,
  type DiscountKind,
} from "@/lib/services/discounts"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead, markLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, getLead, type LeadClass } from "@/lib/services/leads"
import { previewPayment, recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Staff child and Qualified orphan discounts, and Fee waived (#112), through
// the fees module against local Supabase, signed in as each seeded role. Each
// test makes leads of its own, Passed in a year it claims with a schedule of
// its own (tests/support/fee-years.ts).

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// STD 2 Day: TZS 2,000,000. KG 1 Day: TZS 1,100,001, which a quarter off
// leaves at 825,000.75, so the fee rounds to the whole shilling.
const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_001, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function phone() {
  // A leading 3 keeps it clear of the seeded 700 000 numbers and of the
  // other test files' numbers.
  return `03${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in lead in `year`, interviewed and Passed today.
async function passedLead(year: number, className: LeadClass = "STD 2"): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: { fullName: "Discount Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Discounted ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const id = created.data.leadId
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result: "Passed",
    score: 80,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [id, year]))
  return id
}

async function request(leadId: string, kind: DiscountKind = "staff_child", note = "Mother teaches at the school.") {
  return requestDiscount(await signedIn(ADMISSIONS), leadId, kind, note, randomUUID())
}

async function requested(leadId: string, kind: DiscountKind = "staff_child"): Promise<string> {
  const made = await request(leadId, kind)
  if (!made.ok) throw new Error(`request failed: ${JSON.stringify(made.error)}`)
  return made.data
}

async function grant(requestId: string) {
  const decided = await decideDiscount(await signedIn(MANAGER), requestId, { decision: "grant" })
  if (!decided.ok) throw new Error(`grant failed: ${decided.error}`)
}

async function granted(leadId: string, kind: DiscountKind) {
  await grant(await requested(leadId, kind))
}

async function pay(leadId: string, input: Partial<PaymentInput> & { amount: number | null }) {
  return recordPayment(await signedIn(ACCOUNTANT), leadId, { type: "initial_deposit", paidOn: today, ...input }, randomUUID())
}

async function feeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data
}

async function statusOf(leadId: string) {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`)
  return lead.data.status
}

describe("requesting a discount", () => {
  test("shows the Pending request on the lead with who raised it and when, and refuses a second one", async () => {
    const id = await passedLead(await yearWithSchedule())
    const requestId = await requested(id)

    const discounts = await getLeadDiscounts(await signedIn(ACCOUNTANT), id)
    expect(discounts.ok && discounts.data.pending).toMatchObject({
      id: requestId,
      kind: "staff_child",
      note: "Mother teaches at the school.",
      state: "pending",
      requestedBy: ADMISSIONS.name,
      requestedById: ADMISSIONS.id,
      decidedAt: null,
    })
    expect(discounts.ok && discounts.data.pending?.requestedAt.slice(0, 10)).toBeTruthy()

    const second = await requestDiscount(await signedIn(MANAGER), id, "qualified_orphan", "Both parents died.", randomUUID())
    expect(second).toMatchObject({ ok: false, error: { kind: "already-pending", requestedBy: ADMISSIONS.name } })
  })

  test("two requests raised at once end with one request and one refusal", async () => {
    const id = await passedLead(await yearWithSchedule())
    const [admissions, manager] = await Promise.all([signedIn(ADMISSIONS), signedIn(MANAGER)])

    const outcomes = await Promise.all([
      requestDiscount(admissions, id, "staff_child", "First note.", randomUUID()),
      requestDiscount(manager, id, "qualified_orphan", "Second note.", randomUUID()),
    ])

    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1)
    expect(outcomes.filter((outcome) => !outcome.ok).map((outcome) => !outcome.ok && outcome.error.kind)).toEqual(["already-pending"])
    const discounts = await getLeadDiscounts(admissions, id)
    expect(discounts.ok && discounts.data.pending).not.toBeNull()
    expect(discounts.ok && discounts.data.decided).toEqual([])
  })

  test("a retried request returns the same request, and the same id with another request is refused", async () => {
    const id = await passedLead(await yearWithSchedule())
    const admissions = await signedIn(ADMISSIONS)
    const requestId = randomUUID()

    const first = await requestDiscount(admissions, id, "staff_child", "Retried.", requestId)
    const again = await requestDiscount(admissions, id, "staff_child", "Retried.", requestId)
    expect(first.ok).toBe(true)
    expect(again).toEqual(first)
    expect(await requestDiscount(admissions, id, "staff_child", "Different.", requestId)).toEqual({
      ok: false,
      error: { kind: "unavailable" },
    })
  })

  test("refuses a blank note, an unknown kind, a closed lead and a discount the lead already holds", async () => {
    const year = await yearWithSchedule()
    const id = await passedLead(year)
    expect(await request(id, "staff_child", "   ")).toEqual({ ok: false, error: { kind: "invalid", field: "note" } })
    expect(await request(id, "sibling" as DiscountKind)).toEqual({ ok: false, error: { kind: "invalid", field: "kind" } })
    expect(await request(id, "staff_child", "x".repeat(1001))).toEqual({ ok: false, error: { kind: "invalid", field: "note" } })

    await granted(id, "staff_child")
    expect(await request(id, "staff_child")).toEqual({ ok: false, error: { kind: "already-granted" } })

    const declined = await passedLead(year)
    expect((await declineLead(await signedIn(MANAGER), declined, { reason: "Enrolled elsewhere" })).ok).toBe(true)
    expect(await request(declined)).toEqual({ ok: false, error: { kind: "lead-closed" } })
  })
})

describe("deciding a discount", () => {
  test("a grant lowers the School fee and names the discount; the Manager's list loses the request", async () => {
    const id = await passedLead(await yearWithSchedule())
    const requestId = await requested(id)

    const pending = await listPendingDiscountRequests(await signedIn(MANAGER))
    expect(pending.ok && pending.data.find((entry) => entry.id === requestId)).toMatchObject({
      leadId: id,
      className: "STD 2",
      kind: "staff_child",
      requestedBy: ADMISSIONS.name,
      leadOpen: true,
    })
    // Oldest first.
    const times = pending.ok ? pending.data.map((entry) => entry.requestedAt) : []
    expect(times).toEqual(times.toSorted())

    await grant(requestId)
    expect(await feeOf(id)).toMatchObject({
      bandFee: 2_000_000,
      schoolFee: 1_500_000,
      discount: { kind: "staff_child", percent: 25 },
      instalments: [{ amount: 600_000 }, { amount: 600_000 }, { amount: 300_000 }],
    })
    const after = await listPendingDiscountRequests(await signedIn(MANAGER))
    expect(after.ok && after.data.some((entry) => entry.id === requestId)).toBe(false)

    const discounts = await getLeadDiscounts(await signedIn(ADMISSIONS), id)
    expect(discounts.ok && discounts.data.decided).toMatchObject([{ id: requestId, state: "granted", decidedBy: MANAGER.name }])
    // The same grant again is already done; a refusal now is not.
    expect(await decideDiscount(await signedIn(MANAGER), requestId, { decision: "grant" })).toEqual({ ok: true, data: null })
    expect(await decideDiscount(await signedIn(MANAGER), requestId, { decision: "refuse", reason: "No." })).toEqual({
      ok: false,
      error: "not-pending",
    })
  })

  test("a refusal needs a written reason, which the requester reads on the lead, and leaves the fee alone", async () => {
    const id = await passedLead(await yearWithSchedule())
    const requestId = await requested(id)
    const manager = await signedIn(MANAGER)

    expect(await decideDiscount(manager, requestId, { decision: "refuse", reason: "  " })).toEqual({ ok: false, error: "invalid" })
    expect(await decideDiscount(manager, requestId, { decision: "refuse", reason: "Not a member of staff." })).toEqual({
      ok: true,
      data: null,
    })

    const discounts = await getLeadDiscounts(await signedIn(ADMISSIONS), id)
    expect(discounts.ok && discounts.data).toMatchObject({
      pending: null,
      decided: [{ id: requestId, state: "refused", refusalReason: "Not a member of staff.", decidedBy: MANAGER.name }],
    })
    expect(await feeOf(id)).toMatchObject({ schoolFee: 2_000_000, discount: null })
    // A refused request makes way for a new one.
    expect((await request(id, "qualified_orphan")).ok).toBe(true)
  })

  test("each discount's fee, rounded to the whole shilling, and the largest winning", async () => {
    const year = await yearWithSchedule()
    const kg = await passedLead(year, "KG 1")
    await granted(kg, "staff_child")
    expect(await feeOf(kg)).toMatchObject({ bandFee: 1_100_001, schoolFee: 825_001, discount: { kind: "staff_child", percent: 25 } })
    const fee = await feeOf(kg)
    expect(fee.instalments.reduce((sum, instalment) => sum + instalment.amount, 0)).toBe(825_001)

    // Qualified orphan on top of Staff child: the larger one is the discount.
    await granted(kg, "qualified_orphan")
    expect(await feeOf(kg)).toMatchObject({ schoolFee: 0, discount: { kind: "qualified_orphan", percent: 100 } })

    // And the other way round: Staff child granted after Qualified orphan
    // changes nothing.
    const std = await passedLead(year)
    await granted(std, "qualified_orphan")
    await granted(std, "staff_child")
    expect(await feeOf(std)).toMatchObject({ bandFee: 2_000_000, schoolFee: 0, discount: { kind: "qualified_orphan", percent: 100 } })
  })

  test("a grant that brings the fee down to what was paid enrols the lead, with the discount as the cause", async () => {
    const id = await passedLead(await yearWithSchedule())
    expect((await pay(id, { type: "first_instalment", amount: 1_500_000 })).ok).toBe(true)
    expect(await statusOf(id)).toBe("Interviewed")
    expect((await feeOf(id)).priority).toBe("First instalment")

    await granted(id, "staff_child")
    expect(await statusOf(id)).toBe("Enrolled")
    expect(await feeOf(id)).toMatchObject({ priority: "Full", balance: 0, enrolment: { on: today } })
    const cause = await inRolledBackTransaction((sql) =>
      sql.query("select recompute_cause from public.lead_fee_profiles where lead_id = $1", [id]),
    )
    expect(cause.rows[0]).toEqual({ recompute_cause: "discount" })

    const history = await getLeadHistory(await signedIn(ADMISSIONS), id)
    if (!history.ok) throw new Error(history.error)
    const requests = history.data.entries.filter((entry) => entry.record === "discount_requests")
    expect(requests.map((entry) => [entry.action, entry.actor])).toEqual([
      ["update", MANAGER.name],
      ["insert", ADMISSIONS.name],
    ])
    expect(requests[0].changes).toContainEqual({ field: "state", from: "pending", to: "granted" })
  })

  test("a grant waits for a closed lead to reopen, and a refusal does not", async () => {
    const year = await yearWithSchedule()
    const id = await passedLead(year)
    const requestId = await requested(id)
    const marked = await markLead(await signedIn(MANAGER), id, { mark: "archived", reason: "Admission cycle ended" })
    expect(marked.ok).toBe(true)

    const manager = await signedIn(MANAGER)
    expect(await decideDiscount(manager, requestId, { decision: "grant" })).toEqual({ ok: false, error: "lead-closed" })
    const pending = await listPendingDiscountRequests(manager)
    expect(pending.ok && pending.data.find((entry) => entry.id === requestId)?.leadOpen).toBe(false)
    expect(await decideDiscount(manager, requestId, { decision: "refuse", reason: "The lead is archived." })).toEqual({
      ok: true,
      data: null,
    })
  })
})

describe("Fee waived", () => {
  test("is refused without a granted Qualified orphan discount, and with an amount", async () => {
    const year = await yearWithSchedule()
    const id = await passedLead(year)
    expect(await pay(id, { type: "fee_waived", amount: null })).toEqual({ ok: false, error: "not_waivable" })

    await granted(id, "staff_child")
    expect(await pay(id, { type: "fee_waived", amount: null })).toEqual({ ok: false, error: "not_waivable" })

    const orphan = await passedLead(year)
    await granted(orphan, "qualified_orphan")
    expect(await pay(orphan, { type: "fee_waived", amount: 1 })).toEqual({ ok: false, error: "amount_not_allowed" })
  })

  test("is accepted with the grant and makes the lead Full and Enrolled, once", async () => {
    const id = await passedLead(await yearWithSchedule())
    await granted(id, "qualified_orphan")
    expect(await feeOf(id)).toMatchObject({ schoolFee: 0, priority: null })
    expect(await statusOf(id)).toBe("Interviewed")

    const previewed = await previewPayment(await signedIn(ACCOUNTANT), id, { type: "fee_waived", amount: null, paidOn: today })
    expect(previewed).toMatchObject({ ok: true, data: { priority: null, priorityAfter: "Full", balanceAfter: 0 } })

    const recorded = await pay(id, { type: "fee_waived", amount: null })
    expect(recorded).toMatchObject({ ok: true, data: { totalPaid: 0, priority: "Full" } })
    expect(await statusOf(id)).toBe("Enrolled")
    expect(await feeOf(id)).toMatchObject({
      priority: "Full",
      enrolment: { on: today, by: { kind: "payment", type: "fee_waived", amount: null } },
    })

    expect(await pay(id, { type: "fee_waived", amount: null })).toEqual({ ok: false, error: "already_waived" })
  })
})

describe("who may do what", () => {
  test("requests need leads.edit, decisions and the list need discounts.approve", async () => {
    const id = await passedLead(await yearWithSchedule())
    const accountant = await signedIn(ACCOUNTANT)
    expect(await requestDiscount(accountant, id, "staff_child", "No.", randomUUID())).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })

    const requestId = await requested(id)
    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      const client = await signedIn(person)
      expect(await decideDiscount(client, requestId, { decision: "grant" }), person.name).toEqual({ ok: false, error: "forbidden" })
      expect(await listPendingDiscountRequests(client), person.name).toEqual({ ok: false, error: "forbidden" })
    }
    // Everyone who may view leads reads the lead's requests.
    expect((await getLeadDiscounts(accountant, id)).ok).toBe(true)
  })

  test("visitors who are not signed in see nothing and change nothing, and nothing is deleted", async () => {
    const id = await passedLead(await yearWithSchedule())
    const requestId = await requested(id)
    const anon = anonClient()

    expect(await getLeadDiscounts(anon, id)).toEqual({ ok: false, error: "forbidden" })
    expect(await listPendingDiscountRequests(anon)).toEqual({ ok: false, error: "forbidden" })
    expect(await requestDiscount(anon, id, "staff_child", "No.", randomUUID())).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await decideDiscount(anon, requestId, { decision: "grant" })).toEqual({ ok: false, error: "forbidden" })
    const { data } = await anon.from("discount_requests").select("id")
    expect(data ?? []).toEqual([])

    // Not through the API, and not as the database owner either.
    const { error } = await secretClient().from("discount_requests").delete().eq("id", requestId)
    expect(error).not.toBeNull()
    await expect(
      inRolledBackTransaction((sql) => sql.query("delete from public.discount_requests where id = $1", [requestId])),
    ).rejects.toThrow()
  })
})
