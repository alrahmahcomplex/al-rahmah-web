import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import {
  decideDiscount,
  getLeadDiscounts,
  listPendingDiscountRequests,
  requestDiscount,
} from "@/lib/services/discounts"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, getLead, type LeadClass, type NewContact } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { linkSibling, type LinkSiblingInput } from "@/lib/services/sibling-groups"
import {
  decideSiblingRequest,
  dismissSiblingFeeEdit,
  getLeadSiblingRequests,
  listPendingSiblingRequests,
  requestSiblingDiscount,
} from "@/lib/services/sibling-requests"

import { anonClient, asSystem, inRolledBackTransaction, lockExclusively, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Sibling discount requests (#302), through the services and the database
// functions against local Supabase. Each test makes its own families in a
// year it claims. The fathers' names come from the students' names: "Kid
// Juma Hassan" has the father "Juma Hassan".

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// Day fees: KG 1 1,100,000; STD 2 2,000,000; FORM 1 2,800,000.
const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

const KG1 = 1_100_000
const STD2 = 2_000_000
const FORM1 = 2_800_000
const SIBLING = { kind: "sibling", percent: 10 }
const tenOff = (fee: number) => fee - fee / 10
const PROOF = "Birth certificates show the same mother."

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  return {
    fullName: `Sibling Request Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

// A father's name of two words no other test uses.
function father(): string {
  const word = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "a")
  return `R${word()} Q${word()}`
}

async function pass(leadId: string, year: number) {
  const admissions = await signedIn(ADMISSIONS)
  const registered = await registerForInterview(admissions, leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result: "Passed",
    score: 80,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [leadId, year]))
}

// A Passed child in `year`, on a new contact.
async function child(year: number, fatherName: string, className: LeadClass): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: parent() },
    student: { fullName: `Kid${randomUUID().slice(0, 6)} ${fatherName}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  await pass(created.data.leadId, year)
  return created.data.leadId
}

async function link(input: LinkSiblingInput) {
  const linked = await linkSibling(await signedIn(ADMISSIONS), input)
  if (!linked.ok) throw new Error(`link failed: ${JSON.stringify(linked.error)}`)
  return linked.data
}

async function feeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data
}

async function payInFull(leadId: string) {
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "full_payment", amount: (await feeOf(leadId)).schoolFee, paidOn: today },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
}

async function statusOf(leadId: string) {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`)
  return lead.data.status
}

async function membershipOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ group_id: string | null; basis: string | null }>(
          "select group_id, basis from public.sibling_group_members where lead_id = $1",
          [leadId],
        )
      ).rows[0] ?? null,
  )
}

async function resultOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<{ result: string; source: string; cause: string | null }>(
          `select coalesce(r.result::text, 'none') as result, coalesce(r.source::text, 'auto') as source, r.cause
           from (select 1) one left join public.lead_sibling_results r on r.lead_id = $1`,
          [leadId],
        )
      ).rows[0],
  )
}

async function lockedOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query<{ locked: string | null }>("select locked_result::text as locked from public.lead_sibling_results where lead_id = $1", [leadId]))
        .rows[0]?.locked ?? null,
  )
}

// Two children of one father, linked: a group of two. Returns the group.
async function pair(year: number, name: string, first: LeadClass = "STD 2", second: LeadClass = "STD 2") {
  const a = await child(year, name, first)
  const b = await child(year, name, second)
  const linked = await link({ leadId: b, siblingOfLeadId: a })
  if (linked.kind !== "linked") throw new Error(`not linked: ${JSON.stringify(linked)}`)
  return { a, b, group: linked.groupId }
}

// A child of another father linked to `to`: it waits on a request.
async function waitingChild(year: number, to: string, className: LeadClass = "KG 1") {
  const id = await child(year, father(), className)
  expect(await link({ leadId: id, siblingOfLeadId: to })).toMatchObject({ kind: "linked", basis: "request_needed" })
  return id
}

// A lead leaves its group with nothing, as an unlink will.
async function unlink(leadId: string) {
  await asSystem(async (sql) => {
    await sql.query("select public.set_audit_actor('system')")
    await sql.query(
      `update public.sibling_group_members
       set group_id = null, basis = null, joined_at = null, sibling_of_lead_id = null, cause = 'sibling_link'
       where lead_id = $1`,
      [leadId],
    )
  })
}

async function ask(leadId: string, siblingOfLeadId?: string) {
  const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), {
    leadId,
    note: PROOF,
    requestId: randomUUID(),
    siblingOfLeadId,
  })
  if (!asked.ok) throw new Error(`request failed: ${JSON.stringify(asked.error)}`)
  return asked.data
}

async function grant(requestId: string) {
  const decided = await decideSiblingRequest(await signedIn(MANAGER), requestId, { decision: "grant" })
  if (!decided.ok) throw new Error(`grant failed: ${decided.error}`)
}

async function refuse(requestId: string, reason = "The certificates name two mothers.") {
  const decided = await decideSiblingRequest(await signedIn(MANAGER), requestId, { decision: "refuse", reason })
  if (!decided.ok) throw new Error(`refusal failed: ${decided.error}`)
}

async function requestsOf(leadId: string) {
  const read = await getLeadSiblingRequests(await signedIn(ADMISSIONS), leadId)
  if (!read.ok) throw new Error(`read failed: ${read.error}`)
  return read.data
}

describe("granting and refusing", () => {
  test("a grant gives the member the 10% under the group rule; a refusal gives none and the history says why", async () => {
    const year = await yearWithSchedule()
    const { a: dear } = await pair(year, father(), "FORM 1", "STD 2")
    const granted = await waitingChild(year, dear)
    const refused = await waitingChild(year, dear)
    expect(await feeOf(granted)).toMatchObject({ schoolFee: KG1, discount: null })

    await grant(await ask(granted))
    expect(await membershipOf(granted)).toMatchObject({ basis: "granted" })
    expect(await feeOf(granted)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })
    expect(await feeOf(dear)).toMatchObject({ schoolFee: FORM1, discount: null })

    const refusedId = await ask(refused)
    await refuse(refusedId)
    expect(await membershipOf(refused)).toMatchObject({ basis: "refused" })
    expect(await feeOf(refused)).toMatchObject({ schoolFee: KG1, discount: null })
    expect(await requestsOf(refused)).toEqual([
      expect.objectContaining({
        id: refusedId,
        state: "refused",
        refusalReason: "The certificates name two mothers.",
        decidedBy: "Test Manager",
        note: PROOF,
      }),
    ])
    const history = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query<{ n: number }>(
            `select count(*)::int as n from public.audit_log
             where table_name = 'discount_requests' and lead_id = $1 and action = 'update' and actor_kind = 'staff'`,
            [refused],
          )
        ).rows[0].n,
    )
    expect(history).toBe(1)
  })

  test("a grant for an Enrolled student leaves its fee alone, marks a fee edit needed, and anchors its siblings", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const enrolled = await child(year, father(), "STD 2")
    await payInFull(enrolled)
    expect(await statusOf(enrolled)).toBe("Enrolled")
    expect(await lockedOf(enrolled)).toBe("full")

    // Its sibling by another father, and that sibling's brother, not yet Enrolled.
    const { a: other, b: brother } = await pair(year, name, "FORM 1", "KG 1")
    expect(await link({ leadId: enrolled, siblingOfLeadId: other })).toMatchObject({ kind: "linked", basis: "request_needed" })
    expect(await feeOf(other)).toMatchObject({ schoolFee: FORM1, discount: null })

    const requestId = await ask(enrolled)
    await grant(requestId)

    expect(await feeOf(enrolled)).toMatchObject({ schoolFee: STD2, discount: null })
    expect(await lockedOf(enrolled)).toBe("full")
    expect(await requestsOf(enrolled)).toEqual([expect.objectContaining({ state: "granted", feeEdit: "needed" })])
    // Enrolled at full and counting, it is an anchor: both get 10%.
    expect(await feeOf(other)).toMatchObject({ schoolFee: tenOff(FORM1), discount: SIBLING })
    expect(await feeOf(brother)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })

    // Only payments.record may dismiss it, with a reason.
    expect(await dismissSiblingFeeEdit(await signedIn(ADMISSIONS), enrolled, "Invoice already sent.")).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await dismissSiblingFeeEdit(await signedIn(ACCOUNTANT), enrolled, " ")).toEqual({ ok: false, error: "invalid" })
    expect(await dismissSiblingFeeEdit(await signedIn(ACCOUNTANT), enrolled, "Invoice already sent.")).toEqual({ ok: true, data: null })
    expect(await requestsOf(enrolled)).toEqual([
      expect.objectContaining({ feeEdit: "dismissed", feeEditReason: "Invoice already sent.", feeEditClosedBy: "Test Accountant" }),
    ])
    expect(await dismissSiblingFeeEdit(await signedIn(ACCOUNTANT), enrolled, "Again.")).toEqual({ ok: false, error: "not-needed" })
    expect(await feeOf(enrolled)).toMatchObject({ schoolFee: STD2 })
  })

  test("the applied path closes the fee edit once, and a decided request changes no other way", async () => {
    const year = await yearWithSchedule()
    const { a } = await pair(year, father())
    const enrolled = await child(year, father(), "KG 1")
    await payInFull(enrolled)
    await link({ leadId: enrolled, siblingOfLeadId: a })
    const requestId = await ask(enrolled)
    await grant(requestId)

    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      expect((await sql.query("select public.close_sibling_fee_edit($1, 'applied', 'Sibling proof after enrolment') as n", [enrolled])).rows[0].n).toBe(1)
      expect((await sql.query("select public.close_sibling_fee_edit($1, 'applied') as n", [enrolled])).rows[0].n).toBe(0)
      await expect(sql.query("update public.discount_requests set note = 'changed' where id = $1", [requestId])).rejects.toThrow(/update_refused/)
    })
  })
})

describe("one Pending request of each kind", () => {
  test("a Staff child request and a Sibling request wait on one lead at once; Staff child and Qualified orphan still share one", async () => {
    const year = await yearWithSchedule()
    const { a } = await pair(year, father())
    const waiting = await waitingChild(year, a)
    const admissions = await signedIn(ADMISSIONS)

    const staffChild = await requestDiscount(admissions, waiting, "staff_child", "Parent teaches here.", randomUUID())
    expect(staffChild.ok).toBe(true)
    const sibling = await ask(waiting)
    expect(sibling).toEqual(expect.any(String))

    expect(await requestDiscount(admissions, waiting, "qualified_orphan", "Both parents died.", randomUUID())).toMatchObject({
      ok: false,
      error: { kind: "already-pending" },
    })
    expect(
      await requestSiblingDiscount(admissions, { leadId: waiting, note: PROOF, requestId: randomUUID() }),
    ).toMatchObject({ ok: false, error: { kind: "already-pending", requestedBy: "Test Admissions" } })
    // The old function never makes the new kind.
    expect(await admissions.rpc("request_discount", { lead_id: waiting, kind: "sibling", note: "x", request_id: randomUUID() })).toMatchObject({
      error: { message: "invalid" },
    })

    // Today's screens see only the Staff child request.
    const manager = await signedIn(MANAGER)
    const lead = await getLeadDiscounts(admissions, waiting)
    expect(lead.ok && lead.data.pending?.kind).toBe("staff_child")
    expect(lead.ok && lead.data.decided).toEqual([])
    const pending = await listPendingDiscountRequests(manager)
    expect(pending.ok && pending.data.filter((r) => r.leadId === waiting).map((r) => r.kind)).toEqual(["staff_child"])
    const listed = await listPendingSiblingRequests(manager)
    expect(listed.ok && listed.data.filter((r) => r.leadId === waiting).map((r) => r.id)).toEqual([sibling])

    // Both decided independently.
    if (!staffChild.ok) throw new Error("unreachable")
    expect((await decideDiscount(manager, staffChild.data, { decision: "grant" })).ok).toBe(true)
    await grant(sibling)
    // Staff child 25% replaces the 10%.
    expect(await feeOf(waiting)).toMatchObject({ discount: { kind: "staff_child", percent: 25 } })
    expect(await requestsOf(waiting)).toEqual([expect.objectContaining({ state: "granted", feeEdit: null })])
  })
})

describe("a refusal holds", () => {
  test("a name correction that makes the names match keeps a Pending request open, and leaves a refused member refused", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const { a } = await pair(year, name)
    const pendingOne = await waitingChild(year, a)
    const refusedOne = await waitingChild(year, a)
    const admissions = await signedIn(ADMISSIONS)

    const open = await ask(pendingOne)
    await refuse(await ask(refusedOne))

    for (const id of [pendingOne, refusedOne]) {
      expect((await admissions.rpc("update_lead_details", { lead_id: id, changes: { father_full_name: name } })).error).toBeNull()
    }
    expect(await requestsOf(pendingOne)).toEqual([expect.objectContaining({ id: open, state: "pending" })])
    expect(await membershipOf(pendingOne)).toMatchObject({ basis: "request_needed" })
    expect(await membershipOf(refusedOne)).toMatchObject({ basis: "refused" })
    expect(await feeOf(pendingOne)).toMatchObject({ discount: null })
    expect(await feeOf(refusedOne)).toMatchObject({ discount: null })

    // A second request waits and does not count; its grant lifts the refusal.
    const again = await ask(refusedOne)
    expect(await feeOf(refusedOne)).toMatchObject({ discount: null })
    await grant(again)
    expect(await membershipOf(refusedOne)).toMatchObject({ basis: "granted" })
    expect(await feeOf(refusedOne)).toMatchObject({ discount: SIBLING })
  })

  test("re-linking a refused lead elsewhere, with its name now matching, keeps it refused", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const { a, b } = await pair(year, name)
    const refusedOne = await waitingChild(year, a)
    await refuse(await ask(refusedOne))
    const admissions = await signedIn(ADMISSIONS)
    expect((await admissions.rpc("update_lead_details", { lead_id: refusedOne, changes: { father_full_name: name } })).error).toBeNull()

    // With its siblings gone it is alone, and linked to a loose child of the
    // same father it keeps its refusal there.
    await unlink(a)
    await unlink(b)
    const loose = await child(year, name, "STD 2")
    expect(await link({ leadId: refusedOne, siblingOfLeadId: loose })).toMatchObject({ kind: "linked", basis: "refused" })
    expect(await feeOf(refusedOne)).toMatchObject({ discount: null })
  })

  test("a refusal about a group holds against a lead that left it and comes back by a match", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const { a, group } = await pair(year, name)
    const lead = await waitingChild(year, a)
    await refuse(await ask(lead))

    // As an unlink will, it leaves the group with nothing; its name is then
    // made the same as the group's.
    await unlink(lead)
    await asSystem((sql) => sql.query("update public.leads set father_full_name = $2, father_full_name_source = 'edited' where id = $1", [lead, name]))

    expect(await link({ leadId: lead, siblingOfLeadId: a })).toMatchObject({ kind: "linked", basis: "refused", groupId: group })
    expect(await feeOf(lead)).toMatchObject({ discount: null })
  })

  test("a lead refused in a group, granted in another, still can't bring that group in by a match", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const { a, group } = await pair(year, name)
    const lead = await waitingChild(year, a)
    await refuse(await ask(lead))
    await unlink(lead)
    const elsewhere = await child(year, father(), "FORM 1")
    expect(await link({ leadId: lead, siblingOfLeadId: elsewhere })).toMatchObject({ kind: "linked", basis: "request_needed" })
    await grant(await ask(lead))
    expect(await membershipOf(lead)).toMatchObject({ basis: "granted" })

    await asSystem((sql) => sql.query("update public.leads set father_full_name = $2, father_full_name_source = 'edited' where id = $1", [lead, name]))
    expect(await membershipOf(lead)).toMatchObject({ basis: "granted" })
    expect(await linkSibling(await signedIn(ADMISSIONS), { leadId: lead, siblingOfLeadId: a })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "sibling_of" },
    })
    expect((await membershipOf(lead))?.group_id).not.toBe(group)
  })
})

describe("leaving the group", () => {
  test("a granted member linked into another group is checked there, and a Pending request is withdrawn naming who moved it", async () => {
    const year = await yearWithSchedule()
    const other = await pair(year, father())

    // Alone in its group once its siblings leave (as an unlink will), the
    // granted member moves by a link, and its grant stays behind.
    const first = await pair(year, father())
    const granted = await waitingChild(year, first.a)
    await grant(await ask(granted))
    expect(await feeOf(granted)).toMatchObject({ discount: SIBLING })
    await unlink(first.a)
    await unlink(first.b)
    expect(await link({ leadId: granted, siblingOfLeadId: other.a })).toMatchObject({ kind: "linked", basis: "request_needed" })
    // A link never takes a 10% away by itself (R38): it is kept, flagged for
    // the Accountant, though the member no longer counts.
    expect(await resultOf(granted)).toEqual({ result: "ten", source: "legacy", cause: "left_legacy" })
    expect(await feeOf(granted)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })

    const second = await pair(year, father())
    const pendingOne = await waitingChild(year, second.a)
    const open = await ask(pendingOne)
    await unlink(second.a)
    await unlink(second.b)
    expect(await link({ leadId: pendingOne, siblingOfLeadId: other.a })).toMatchObject({ kind: "linked", basis: "request_needed" })
    expect(await requestsOf(pendingOne)).toEqual([
      expect.objectContaining({ id: open, state: "withdrawn", withdrawnReason: "left_group", withdrawnBy: "Test Admissions" }),
    ])
    expect(await decideSiblingRequest(await signedIn(MANAGER), open, { decision: "grant" })).toEqual({ ok: false, error: "not-pending" })
  })
})

describe("merges", () => {
  test("a Pending request follows its group into a merge, and its grant counts in the merged group", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const first = await pair(year, name, "STD 2", "STD 2")
    const waiting = await waitingChild(year, first.a)
    const open = await ask(waiting)
    const second = await pair(year, name, "FORM 1", "KG 1")

    // Same fathers: the first group joins the second, the waiting child with it.
    expect(await link({ leadId: first.b, siblingOfLeadId: second.a })).toMatchObject({ kind: "linked", basis: "matched", groupId: second.group })
    expect(await membershipOf(waiting)).toEqual({ group_id: second.group, basis: "request_needed" })
    expect(await requestsOf(waiting)).toEqual([expect.objectContaining({ id: open, state: "pending", groupId: second.group })])

    await grant(open)
    expect(await membershipOf(waiting)).toEqual({ group_id: second.group, basis: "granted" })
    expect(await feeOf(waiting)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })
  })
})

describe("across groups", () => {
  test("a merge whose names differ is a request; a grant merges the groups and a refusal holds against a later match", async () => {
    const year = await yearWithSchedule()
    const left = await pair(year, father(), "STD 2", "KG 1")
    const right = await pair(year, father(), "FORM 1", "KG 1")
    const admissions = await signedIn(ADMISSIONS)

    expect(await linkSibling(admissions, { leadId: left.b, siblingOfLeadId: right.a })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "sibling_of" },
    })
    // A lead alone, or in the same group, links instead.
    expect(await requestSiblingDiscount(admissions, { leadId: left.b, note: PROOF, requestId: randomUUID(), siblingOfLeadId: left.a })).toMatchObject({
      ok: false,
      error: { kind: "already-counts" },
    })

    const requestId = await ask(left.b, right.a)
    expect(await listPendingSiblingRequests(await signedIn(MANAGER))).toMatchObject({
      ok: true,
      data: expect.arrayContaining([expect.objectContaining({ id: requestId, acrossGroups: true, siblingOfLeadId: right.a })]),
    })
    await grant(requestId)
    for (const id of [left.a, left.b, right.a, right.b]) {
      expect((await membershipOf(id))?.group_id).toBe(right.group)
    }
    expect(await membershipOf(left.b)).toMatchObject({ basis: "granted" })
    expect(await membershipOf(left.a)).toMatchObject({ basis: "matched" })
    expect(await feeOf(right.a)).toMatchObject({ schoolFee: FORM1, discount: null })
    expect(await feeOf(left.a)).toMatchObject({ schoolFee: tenOff(STD2), discount: SIBLING })

    // Refused across groups: no name edit gets round it.
    const one = await pair(year, father())
    const two = await pair(year, father())
    await refuse(await ask(one.b, two.a))
    const twoName = await inRolledBackTransaction(
      async (sql) => (await sql.query<{ n: string }>("select father_full_name as n from public.leads where id = $1", [two.a])).rows[0].n,
    )
    await asSystem((sql) =>
      sql.query("update public.leads set father_full_name = $2, father_full_name_source = 'edited' where id = any($1)", [[one.a, one.b], twoName]),
    )
    for (const [from, to] of [
      [one.b, two.a],
      [one.a, two.b],
      [two.a, one.a],
    ]) {
      expect(await linkSibling(admissions, { leadId: from, siblingOfLeadId: to })).toEqual({
        ok: false,
        error: { kind: "invalid", field: "sibling_of" },
      })
    }
    expect((await membershipOf(one.a))?.group_id).toBe(one.group)
    expect((await membershipOf(two.a))?.group_id).toBe(two.group)
  })
})

describe("who may request and decide", () => {
  test("requesting needs leads.edit and a linked lead; deciding needs discounts.approve", async () => {
    const year = await yearWithSchedule()
    const { a } = await pair(year, father())
    const waiting = await waitingChild(year, a)
    const loose = await child(year, father(), "KG 1")
    const input = { leadId: waiting, note: PROOF, requestId: randomUUID() }

    expect(await requestSiblingDiscount(anonClient(), input)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await requestSiblingDiscount(await signedIn(ACCOUNTANT), input)).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await requestSiblingDiscount(await signedIn(ADMISSIONS), { ...input, note: " " })).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "note" },
    })
    expect(await requestSiblingDiscount(await signedIn(ADMISSIONS), { ...input, leadId: loose })).toMatchObject({
      ok: false,
      error: { kind: "invalid", field: "sibling_of", reason: "not_linked" },
    })
    expect(await requestSiblingDiscount(await signedIn(ADMISSIONS), { ...input, leadId: a })).toEqual({
      ok: false,
      error: { kind: "already-counts" },
    })

    const made = await requestSiblingDiscount(await signedIn(ADMISSIONS), input)
    expect(made.ok).toBe(true)
    // A retry with the same id gets the same request.
    expect(await requestSiblingDiscount(await signedIn(ADMISSIONS), input)).toEqual(made)
    if (!made.ok) throw new Error("unreachable")

    expect(await decideSiblingRequest(await signedIn(ADMISSIONS), made.data, { decision: "grant" })).toEqual({ ok: false, error: "forbidden" })
    expect(await decideSiblingRequest(await signedIn(ACCOUNTANT), made.data, { decision: "grant" })).toEqual({ ok: false, error: "forbidden" })
    expect(await decideSiblingRequest(await signedIn(MANAGER), made.data, { decision: "refuse", reason: " " })).toEqual({
      ok: false,
      error: "invalid",
    })
    expect(await getLeadSiblingRequests(anonClient(), waiting)).toEqual({ ok: false, error: "forbidden" })
    expect(await listPendingSiblingRequests(await signedIn(ADMISSIONS))).toEqual({ ok: false, error: "forbidden" })

    await grant(made.data)
    // The same grant again is already done.
    expect(await decideSiblingRequest(await signedIn(MANAGER), made.data, { decision: "grant" })).toEqual({ ok: true, data: null })
  })
})

describe("migration day", () => {
  test("the snapshot check passes with nothing moved, and raises when a fee moves", async () => {
    const year = await yearWithSchedule()
    const { b } = await pair(year, father(), "FORM 1", "KG 1")
    expect(await feeOf(b)).toMatchObject({ discount: SIBLING })

    await inRolledBackTransaction(async (sql) => {
      await lockExclusively(sql, [
        "public.leads",
        "public.guardian_contacts",
        "public.lead_fee_profiles",
        "public.lead_sibling_results",
        "public.sibling_groups",
        "public.sibling_group_members",
        "public.school_fee_payments",
        "public.payment_adjustments",
        "public.discount_requests",
        "public.fee_schedules",
        "public.fee_band_amounts",
      ])
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("create temp table sibling_request_before as select * from public.fee_snapshot()")
      // What the migration changed that a fee reads: the discount and the counting rule.
      await sql.query("select * from public.lead_discount($1)", [b])
      await sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.sibling_request_before')")

      await sql.query("update public.lead_sibling_results set result = 'none', source = 'auto' where lead_id = $1", [b])
      await expect(sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.sibling_request_before')")).rejects.toThrow(
        /fee_snapshot_changed/,
      )
    })
  })
})
