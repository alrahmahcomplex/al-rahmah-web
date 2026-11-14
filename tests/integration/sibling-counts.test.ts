import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, type LeadClass, type NewContact } from "@/lib/services/leads"
import { adjustPayment } from "@/lib/services/payment-adjustments"
import { recordPayment } from "@/lib/services/school-fee-payments"
import {
  explainSiblingGroup,
  getSiblingFeeCounts,
  getSiblingLeadCounts,
  getSiblingRequestCounts,
  type SiblingFeeCounts,
  type SiblingLeadCounts,
  type SiblingMemberExplanation,
  type SiblingRequestCounts,
  type StaffCount,
} from "@/lib/services/sibling-counts"
import { editSiblingFee, linkSibling, setPriorSibling, type LinkSiblingInput } from "@/lib/services/sibling-groups"
import {
  decideSiblingRequest,
  dismissSiblingFeeEdit,
  getLeadSiblingRequests,
  listPendingSiblingRequests,
  requestSiblingDiscount,
} from "@/lib/services/sibling-requests"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SEEDED_AGENT } from "../support/fixtures"

// The Sibling counts, the group explanation and the invariant check (#306),
// through the services and the database functions against local Supabase.
// Each test makes its own families in a year it claims and reads the counts
// for that year, where every count must hold exactly its seeded cases and
// nothing else among this file's leads. "Kidabc Juma Hassan" has the father "Juma Hassan".

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

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

const PROOF = "Same mother; birth certificates promised for Thursday."

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  // A leading 08 keeps it clear of the seeded numbers and the other sibling suites.
  return {
    fullName: `Counts Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `08${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

// A father's name of two words no other test uses.
function father(): string {
  const word = () =>
    randomUUID()
      .replace(/[^a-f]/g, "")
      .slice(0, 6)
      .padEnd(6, "a")
  return `F${word()} H${word()}`
}

// An open lead in `year`, on a new contact or on `contactId`, with no interview.
async function lead(year: number, fatherName: string, className: LeadClass, contactId?: string): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: contactId ? { contactId } : { contact: parent() },
    student: {
      fullName: `Kid${randomUUID().slice(0, 6)} ${fatherName}`,
      className,
      enrollmentYear: thisYear + 1,
      dayOrBoarding: "Day",
    },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  await asSystem((sql) =>
    sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, year]),
  )
  mine.add(created.data.leadId)
  return created.data.leadId
}

// A Passed lead in `year`, so it has a School fee and can enrol.
async function child(year: number, fatherName: string, className: LeadClass, contactId?: string): Promise<string> {
  const id = await lead(year, fatherName, className, contactId)
  const admissions = await signedIn(ADMISSIONS)
  const registered = await registerForInterview(admissions, id)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, {
    interviewDate: today,
    result: "Passed",
    score: 80,
  })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  return id
}

async function contactOf(leadId: string): Promise<string> {
  return asSystem(
    async (sql) =>
      (await sql.query<{ id: string }>("select guardian_contact_id as id from public.leads where id = $1", [leadId]))
        .rows[0].id,
  )
}

async function link(input: LinkSiblingInput, by: SupabaseClient | null = null) {
  const linked = await linkSibling(by ?? (await signedIn(ADMISSIONS)), input)
  if (!linked.ok) throw new Error(`link failed: ${JSON.stringify(linked.error)}`)
  return linked.data
}

// Two children of one father on two contacts, linked: registered together.
// The dearer one pays full and the cheaper gets the 10% at once.
async function together(year: number) {
  const name = father()
  const dear = await child(year, name, "STD 2")
  const cheap = await child(year, name, "KG 1")
  const linked = await link({ leadId: cheap, siblingOfLeadId: dear })
  if (linked.kind !== "linked") throw new Error(`not linked: ${JSON.stringify(linked)}`)
  return { dear, cheap, group: linked.groupId }
}

// A child of another father linked to `to`: it waits on a request.
async function waitingChild(year: number, to: string, name = father()) {
  const id = await child(year, name, "KG 1")
  expect(await link({ leadId: id, siblingOfLeadId: to })).toMatchObject({
    kind: "linked",
    basis: "request_needed",
  })
  return id
}

async function payInFull(leadId: string): Promise<string> {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  const paid = await recordPayment(
    await signedIn(ACCOUNTANT),
    leadId,
    { type: "full_payment", amount: fee.data.schoolFee, paidOn: today },
    randomUUID(),
  )
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
  return paid.data.paymentId
}

async function ask(leadId: string) {
  const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), {
    leadId,
    note: PROOF,
    requestId: randomUUID(),
  })
  if (!asked.ok) throw new Error(`request failed: ${JSON.stringify(asked.error)}`)
  return asked.data
}

async function decide(requestId: string, decision: "grant" | "refuse") {
  const decided = await decideSiblingRequest(
    await signedIn(MANAGER),
    requestId,
    decision === "grant" ? { decision: "grant" } : { decision: "refuse", reason: "The certificates name two mothers." },
  )
  if (!decided.ok) throw new Error(`decision failed: ${decided.error}`)
}

async function edit(
  by: SupabaseClient,
  leadId: string,
  value: "full" | "ten" | "automatic",
  reason: Parameters<typeof editSiblingFee>[1]["reason"],
) {
  const saved = await editSiblingFee(by, { leadId, value, reason }, randomUUID())
  if (!saved.ok) throw new Error(`edit failed: ${JSON.stringify(saved.error)}`)
  return saved.data.editId
}

async function correct(leadId: string, changes: Record<string, unknown>) {
  const { error } = await (await signedIn(ADMISSIONS)).rpc("update_lead_details", { lead_id: leadId, changes })
  if (error) throw new Error(`correction failed: ${error.message}`)
}

// The tests share their years with leads other suites and earlier runs left
// there (claimed years are reused), so each count is checked two ways: every
// number matches the rows it comes with, and the rows on this file's leads
// are exactly the seeded cases. Each reader below returns only those rows,
// with the numbers worked out from them.
const mine = new Set<string>()
const own = (ids: string[]) => ids.filter((id) => mine.has(id))
// Years are claimed per test and reused, so a test owns only its own leads.
beforeEach(() => mine.clear())

function byStaffOf(rows: { staffId: string | null }[], names: StaffCount[]): StaffCount[] {
  const counts = new Map<string | null, number>()
  for (const row of rows) counts.set(row.staffId, (counts.get(row.staffId) ?? 0) + 1)
  return [...counts]
    .map(([staffId, count]) => ({
      staffId,
      staffName: names.find((n) => n.staffId === staffId)?.staffName ?? null,
      count,
    }))
    .sort((a, b) => b.count - a.count || (a.staffName ?? "").localeCompare(b.staffName ?? ""))
}

const total = (rows: { count: number }[]) => rows.reduce((sum, row) => sum + row.count, 0)

// How many times each key occurs, and a by-staff list as the same shape.
function tally(keys: (string | null)[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const key of keys) counts[String(key)] = (counts[String(key)] ?? 0) + 1
  return counts
}
const bucketsOf = (rows: StaffCount[]) => Object.fromEntries(rows.map((row) => [String(row.staffId), row.count]))

async function leadCounts(year: number, as: SupabaseClient | null = null): Promise<SiblingLeadCounts> {
  const read = await getSiblingLeadCounts(as ?? (await signedIn(ADMISSIONS)), year)
  if (!read.ok) throw new Error(`lead counts failed: ${read.error}`)
  const { typoConfirmed: typo, previousSchool: school } = read.data
  expect(typo.count).toBe(typo.members.length)
  expect(total(typo.byStaff)).toBe(typo.count)
  // Each bucket, not only the total, matches the rows it comes with.
  expect(bucketsOf(typo.byStaff)).toEqual(tally(typo.members.map((m) => m.staffId)))
  expect([school.notKnown, school.missing]).toEqual([school.notKnownLeadIds.length, school.missingLeadIds.length])
  expect(school.count).toBe(school.notKnown + school.missing)

  const members = typo.members.filter((m) => mine.has(m.leadId))
  const notKnownLeadIds = own(school.notKnownLeadIds)
  const missingLeadIds = own(school.missingLeadIds)
  return {
    typoConfirmed: {
      count: members.length,
      byStaff: byStaffOf(members, typo.byStaff),
      members,
    },
    previousSchool: {
      count: notKnownLeadIds.length + missingLeadIds.length,
      notKnown: notKnownLeadIds.length,
      missing: missingLeadIds.length,
      notKnownLeadIds,
      missingLeadIds,
    },
  }
}

async function feeCounts(year: number, as: SupabaseClient | null = null): Promise<SiblingFeeCounts> {
  const read = await getSiblingFeeCounts(as ?? (await signedIn(ACCOUNTANT)), year)
  if (!read.ok) throw new Error(`fee counts failed: ${read.error}`)
  const { feeEdits, keptTen, enrolledTenNoFull, feeEditNeeded } = read.data
  expect(feeEdits.count).toBe(feeEdits.edits.length)
  expect(total(feeEdits.byStaff)).toBe(feeEdits.count)
  expect(Object.values(feeEdits.byReason).reduce((a, b) => a + b, 0)).toBe(feeEdits.count)
  expect(bucketsOf(feeEdits.byStaff)).toEqual(tally(feeEdits.edits.map((e) => e.staffId)))
  expect(feeEdits.byReason).toEqual({
    full_fee_sibling_not_enrolled: 0,
    sibling_proof_after_enrolment: 0,
    data_entry_correction: 0,
    ...tally(feeEdits.edits.map((e) => e.reason)),
  })
  expect(keptTen.count).toBe(keptTen.leadIds.length)
  expect(enrolledTenNoFull.count).toBe(enrolledTenNoFull.leadIds.length)
  expect(feeEditNeeded.count).toBe(feeEditNeeded.requests.length)

  const edits = feeEdits.edits.filter((e) => mine.has(e.leadId))
  const byReason = {
    full_fee_sibling_not_enrolled: 0,
    sibling_proof_after_enrolment: 0,
    data_entry_correction: 0,
  }
  for (const e of edits) byReason[e.reason] += 1
  const requests = feeEditNeeded.requests.filter((r) => mine.has(r.leadId))
  return {
    feeEdits: {
      count: edits.length,
      byReason,
      byStaff: byStaffOf(edits, feeEdits.byStaff),
      edits,
    },
    keptTen: {
      count: own(keptTen.leadIds).length,
      leadIds: own(keptTen.leadIds),
    },
    enrolledTenNoFull: {
      count: own(enrolledTenNoFull.leadIds).length,
      leadIds: own(enrolledTenNoFull.leadIds),
    },
    feeEditNeeded: { count: requests.length, requests },
  }
}

async function requestCounts(year: number): Promise<SiblingRequestCounts> {
  const read = await getSiblingRequestCounts(await signedIn(MANAGER), year)
  if (!read.ok) throw new Error(`request counts failed: ${read.error}`)
  const { pending } = read.data
  expect(pending.count).toBe(pending.requests.length)
  expect(pending.oldestRequestedAt).toBe(pending.requests[0]?.requestedAt ?? null)

  const requests = pending.requests.filter((r) => mine.has(r.leadId))
  return {
    pending: {
      count: requests.length,
      oldestRequestedAt: requests[0]?.requestedAt ?? null,
      requests,
    },
  }
}

// The explanation of one member, read through its own lead.
async function explain(leadId: string, as: SupabaseClient | null = null): Promise<SiblingMemberExplanation> {
  const read = await explainSiblingGroup(as ?? (await signedIn(ACCOUNTANT)), leadId)
  if (!read.ok) throw new Error(`explain failed: ${read.error}`)
  const own = read.data.members.find((m) => m.leadId === leadId)
  if (!own) throw new Error(`lead ${leadId} is not among its own group's members`)
  return own
}

type Break = {
  kind: string
  group_id: string | null
  lead_id: string | null
  detail: unknown
}

// The breaks that touch this file's leads.
function ours(rows: Break[]): Break[] {
  return rows.filter((b) => {
    const named = (b.detail as { lead_ids?: string[] } | null)?.lead_ids ?? []
    return (b.lead_id !== null && mine.has(b.lead_id)) || named.some((id) => mine.has(id))
  })
}

async function breaks(year: number): Promise<Break[]> {
  return inRolledBackTransaction(async (sql) =>
    ours(
      (
        await sql.query<Break>("select kind, group_id, lead_id, detail from public.sibling_invariant_breaks($1)", [
          year,
        ])
      ).rows,
    ),
  )
}

const sorted = (ids: string[]) => [...ids].sort()

describe("the lead counts (leads.view)", () => {
  test("typing mistakes confirmed at the desk, by staff member; a match and two different names are not counted", async () => {
    const year = await yearWithSchedule()
    // Below STD 2, so no previous school is asked of any of them.
    const typo = async (by: SupabaseClient) => {
      const stem = father()
      const first = await lead(year, `Mohamed ${stem}`, "KG 2")
      const second = await lead(year, `Mohammed ${stem}`, "KG 1")
      expect(await link({ leadId: second, siblingOfLeadId: first }, by)).toMatchObject({ kind: "name-question" })
      expect(
        await link(
          {
            leadId: second,
            siblingOfLeadId: first,
            answer: "typo",
            spelling: `Mohamed ${stem}`,
          },
          by,
        ),
      ).toMatchObject({ kind: "linked", basis: "typo_confirmed" })
      return second
    }
    const byDesk = await typo(await signedIn(ADMISSIONS))
    const byManager = await typo(await signedIn(MANAGER))

    // Near misses: the same name, and two different names.
    const same = father()
    const sameFirst = await lead(year, same, "KG 2")
    expect(
      await link({
        leadId: await lead(year, same, "KG 1"),
        siblingOfLeadId: sameFirst,
      }),
    ).toMatchObject({
      basis: "matched",
    })
    const stem = father()
    const differentFirst = await lead(year, `Mohamed ${stem}`, "KG 2")
    const different = await lead(year, `Mohammed ${stem}`, "KG 1")
    expect(
      await link({
        leadId: different,
        siblingOfLeadId: differentFirst,
        answer: "different",
      }),
    ).toMatchObject({
      basis: "request_needed",
    })

    const counts = await leadCounts(year)
    expect(counts.typoConfirmed.count).toBe(2)
    expect(sorted(counts.typoConfirmed.members.map((m) => m.leadId))).toEqual(sorted([byDesk, byManager]))
    expect(counts.typoConfirmed.byStaff).toEqual([
      { staffId: ADMISSIONS.id, staffName: "Test Admissions", count: 1 },
      { staffId: MANAGER.id, staffName: "Test Manager", count: 1 },
    ])
    expect(counts.previousSchool).toEqual({
      count: 0,
      notKnown: 0,
      missing: 0,
      notKnownLeadIds: [],
      missingLeadIds: [],
    })

    // The explanation of a name that still differs, with no request yet.
    expect(await explain(different)).toMatchObject({
      reason: "request_needed",
      becauseOf: [],
      notes: [],
    })
    expect(await breaks(year)).toEqual([])
  })

  test("previous schools to add: Not known yet and missing from STD 2 up, on open leads only", async () => {
    const year = await yearWithSchedule()
    const notKnown = await lead(year, father(), "STD 3")
    await correct(notKnown, { previous_school_not_known: true })
    const missing = await lead(year, father(), "STD 4")
    // Near misses: a school given, a KG 2 child (not asked below STD 2) and a
    // Declined lead.
    const named = await lead(year, father(), "STD 2")
    await correct(named, {
      previous_school_name: "Mfano English Medium School",
      previous_school_type: "private",
      previous_school_region: "Pwani",
    })
    await lead(year, father(), "KG 2")
    const declined = await lead(year, father(), "STD 5")
    expect(
      (
        await declineLead(await signedIn(MANAGER), declined, {
          reason: "Other",
          explanation: "Moved away.",
        })
      ).ok,
    ).toBe(true)

    expect((await leadCounts(year)).previousSchool).toEqual({
      count: 2,
      notKnown: 1,
      missing: 1,
      notKnownLeadIds: [notKnown],
      missingLeadIds: [missing],
    })

    // Adding the school takes it off the count.
    await correct(missing, {
      previous_school_name: "Mfano Primary School",
      previous_school_type: "public",
      previous_school_region: "Pwani",
    })
    expect((await leadCounts(year)).previousSchool).toMatchObject({
      count: 1,
      missing: 0,
      missingLeadIds: [],
    })
  })
})

describe("the fee counts (payments.view)", () => {
  test("manual fee edits by reason and by accountant", async () => {
    const year = await yearWithSchedule()
    const accountant = await signedIn(ACCOUNTANT)
    const second = await createThrowawayStaff(["leads.view", "payments.view", "payments.record"])
    const g1 = await together(year)
    const g2 = await together(year)

    const first = await edit(accountant, g1.cheap, "full", "full_fee_sibling_not_enrolled")
    const back = await edit(accountant, g1.cheap, "automatic", "data_entry_correction")
    const other = await edit(await signedIn(second), g2.dear, "ten", "data_entry_correction")

    const counts = await feeCounts(year)
    expect(counts.feeEdits.count).toBe(3)
    expect(counts.feeEdits.byReason).toEqual({
      full_fee_sibling_not_enrolled: 1,
      sibling_proof_after_enrolment: 0,
      data_entry_correction: 2,
    })
    expect(counts.feeEdits.byStaff).toEqual([
      { staffId: ACCOUNTANT.id, staffName: "Test Accountant", count: 2 },
      { staffId: second.id, staffName: second.name, count: 1 },
    ])
    expect(sorted(counts.feeEdits.edits.map((e) => e.editId))).toEqual(sorted([first, back, other]))
    expect(counts.keptTen.count).toBe(0)
    expect(counts.enrolledTenNoFull.count).toBe(0)
    expect(counts.feeEditNeeded.count).toBe(0)

    // The explanation names the manual value; its edit is for payments.view.
    expect(await explain(g2.dear)).toMatchObject({
      reason: "manual_ten",
      feeEdit: {
        editId: other,
        value: "ten",
        reason: "data_entry_correction",
        staffName: second.name,
      },
    })
    const onlyLeads = await createThrowawayStaff(["leads.view"])
    expect(await explain(g2.dear, await signedIn(onlyLeads))).toMatchObject({
      reason: "manual_ten",
      feeEdit: null,
    })
    // A manual 10% on the full payer hands the place to its sibling.
    expect(await explain(g2.cheap)).toMatchObject({
      reason: "full_payer",
      highestFee: true,
    })
    expect(await explain(g2.cheap, await signedIn(onlyLeads))).toMatchObject({
      reason: "full_payer",
      highestFee: null,
    })
    // Back to automatic: the rule's answer again.
    expect(await explain(g1.cheap)).toMatchObject({
      reason: "full_payer_sibling",
      becauseOf: [g1.dear],
    })
    expect(await breaks(year)).toEqual([])
  })

  test("a 10% kept when leaving legacy; a legacy member that kept nothing is not counted", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const enrolled = await child(year, name, "STD 2")
    const kept = await child(year, name, "KG 1", await contactOf(enrolled))
    await payInFull(enrolled)
    expect(await explain(kept)).toMatchObject({
      reason: "legacy_sibling_enrolled",
      legacy: true,
      becauseOf: [enrolled],
    })

    // Linked to a child of another father, it leaves its Family's group and
    // keeps the 10% the new rule would take away.
    expect(
      await link({
        leadId: kept,
        siblingOfLeadId: await child(year, father(), "STD 2"),
      }),
    ).toMatchObject({
      basis: "request_needed",
    })

    // Near miss: linked to its Enrolled sibling with the same name, it keeps
    // the 10% by the rule, with nothing to flag.
    const other = father()
    const anchor = await child(year, other, "STD 2")
    const matched = await child(year, other, "KG 1", await contactOf(anchor))
    await payInFull(anchor)
    expect(
      await link({
        leadId: matched,
        siblingOfLeadId: anchor,
        siblingFatherFullName: other,
      }),
    ).toMatchObject({
      basis: "matched",
    })

    expect((await feeCounts(year)).keptTen).toEqual({
      count: 1,
      leadIds: [kept],
    })
    expect(await explain(kept)).toMatchObject({
      reason: "kept_when_leaving_legacy",
      result: "ten",
      source: "legacy",
    })
    expect(await explain(matched)).toMatchObject({
      reason: "anchor",
      becauseOf: [anchor],
    })
    expect(await explain(anchor)).toMatchObject({ reason: "enrolled_full" })
    expect(await breaks(year)).toEqual([])
  })

  test("Enrolled with the Sibling 10% and nobody Enrolled at full; an anchor, the tick or a 10% set by hand leaves a lead out", async () => {
    const year = await yearWithSchedule()

    // The owner's case: the cheaper child enrols at 10%, the dearer has not.
    const alone = await together(year)
    await payInFull(alone.cheap)
    // Near miss: the dearer child enrols at full too.
    const anchored = await together(year)
    await payInFull(anchored.cheap)
    await payInFull(anchored.dear)
    // Near miss: the prior-sibling tick.
    const ticked = await child(year, father(), "STD 2")
    expect(
      (
        await setPriorSibling(await signedIn(ADMISSIONS), ticked, {
          name: "An Older Sibling",
          className: "STD 6",
        })
      ).ok,
    ).toBe(true)
    await payInFull(ticked)
    // Near miss: the Accountant set the 10% by hand.
    const byHand = await together(year)
    await payInFull(byHand.cheap)
    await edit(await signedIn(ACCOUNTANT), byHand.cheap, "ten", "sibling_proof_after_enrolment")

    expect((await feeCounts(year)).enrolledTenNoFull).toEqual({
      count: 1,
      leadIds: [alone.cheap],
    })

    expect(await explain(alone.cheap)).toMatchObject({
      reason: "enrolled_ten_full_payer_waiting",
      becauseOf: [alone.dear],
    })
    expect(await explain(alone.dear)).toMatchObject({
      reason: "full_payer",
      fullPayer: true,
      highestFee: true,
    })
    expect(await explain(anchored.cheap)).toMatchObject({
      reason: "enrolled_ten_anchor",
      becauseOf: [anchored.dear],
    })
    expect(await explain(anchored.dear)).toMatchObject({
      reason: "enrolled_full",
      lockedResult: "full",
    })
    expect(await explain(ticked)).toMatchObject({
      reason: "prior_sibling",
      notes: ["prior_sibling_tick"],
    })
    expect(await explain(byHand.cheap)).toMatchObject({
      reason: "manual_ten",
      lockedResult: "ten",
    })

    // When the dearer child is Declined, nobody pays full.
    expect(
      (
        await declineLead(await signedIn(MANAGER), alone.dear, {
          reason: "Other",
          explanation: "Did not enrol.",
        })
      ).ok,
    ).toBe(true)
    expect(await explain(alone.cheap)).toMatchObject({
      reason: "enrolled_ten_no_full",
      becauseOf: [],
    })
    expect((await feeCounts(year)).enrolledTenNoFull).toEqual({
      count: 1,
      leadIds: [alone.cheap],
    })

    // A payment correction takes the full payer out of Enrolled: it keeps its
    // fixed full result, but nobody is Enrolled at full and it is not a full
    // payer still to enrol.
    const corrected = await together(year)
    await payInFull(corrected.cheap)
    const dearPayment = await payInFull(corrected.dear)
    const voided = await adjustPayment(
      await signedIn(ACCOUNTANT),
      dearPayment,
      { reason: "Duplicate entry", void: true, note: null },
      randomUUID(),
    )
    expect(voided.ok).toBe(true)
    expect(await explain(corrected.dear)).toMatchObject({
      reason: "locked_not_enrolled",
      lockedResult: "full",
      status: "Interviewed",
    })
    expect(await explain(corrected.cheap)).toMatchObject({
      reason: "enrolled_ten_no_full",
      becauseOf: [],
    })
    expect((await feeCounts(year)).enrolledTenNoFull).toEqual({
      count: 2,
      leadIds: sorted([alone.cheap, corrected.cheap]),
    })
    expect(await breaks(year)).toEqual([])
  })

  test("granted requests waiting for a fee edit; an applied and a dismissed one are not", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const other = await child(year, name, "FORM 1")
    await link({
      leadId: await child(year, name, "KG 1"),
      siblingOfLeadId: other,
    })

    // Three students Enrolled at full, each by another father, each granted.
    const enrolled: string[] = []
    for (let i = 0; i < 3; i++) {
      const id = await child(year, father(), "STD 2")
      await payInFull(id)
      expect(await link({ leadId: id, siblingOfLeadId: other })).toMatchObject({
        basis: "request_needed",
      })
      await decide(await ask(id), "grant")
      enrolled.push(id)
    }
    const [needed, applied, dismissed] = enrolled
    const appliedEdit = await edit(await signedIn(ACCOUNTANT), applied, "ten", "sibling_proof_after_enrolment")
    expect((await dismissSiblingFeeEdit(await signedIn(ACCOUNTANT), dismissed, "Invoice already sent.")).ok).toBe(true)

    const counts = await feeCounts(year)
    expect(counts.feeEditNeeded.count).toBe(1)
    expect(counts.feeEditNeeded.requests).toEqual([expect.objectContaining({ leadId: needed, leadOpen: true })])
    expect(counts.feeEdits.count).toBe(1)
    expect(counts.feeEdits.edits.map((e) => e.editId)).toEqual([appliedEdit])

    expect(await explain(needed)).toMatchObject({
      reason: "enrolled_full",
      notes: ["granted", "fee_edit_needed"],
      decidedRequest: { state: "granted", feeEdit: "needed" },
    })
    expect(await explain(dismissed)).toMatchObject({
      reason: "enrolled_full",
      notes: ["granted"],
    })
    expect(await breaks(year)).toEqual([])
  })
})

describe("the request counts (discounts.approve)", () => {
  test("Pending Sibling requests by age; a withdrawn, a refused and a granted one are not counted", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const a = await child(year, name, "STD 2")
    await link({
      leadId: await child(year, name, "STD 2"),
      siblingOfLeadId: a,
    })

    const pending = await waitingChild(year, a)
    const pendingId = await ask(pending)
    const refused = await waitingChild(year, a)
    await decide(await ask(refused), "refuse")
    const granted = await waitingChild(year, a)
    await decide(await ask(granted), "grant")
    // Withdrawn: its group breaks up (as an unlink will) and a link moves it
    // into another group, so it leaves the group it asked about.
    const elsewhere = father()
    const c = await child(year, elsewhere, "STD 2")
    const d = await child(year, elsewhere, "STD 2")
    await link({ leadId: d, siblingOfLeadId: c })
    const moved = await waitingChild(year, c)
    const movedId = await ask(moved)
    await asSystem(async (sql) => {
      await sql.query(
        `update public.sibling_groups g set full_payer_lead_id = null, full_payer_chosen_at = null, updated_at = now()
         from public.sibling_group_members m where m.lead_id = $1 and g.id = m.group_id`,
        [c],
      )
      await sql.query(
        `update public.sibling_group_members
         set group_id = null, basis = null, joined_at = null, sibling_of_lead_id = null, cause = 'sibling_link'
         where lead_id = any($1::uuid[])`,
        [[c, d]],
      )
      for (const id of [c, d]) await sql.query("select public.recompute_lead_fee($1, 'sibling')", [id])
    })
    expect(await link({ leadId: moved, siblingOfLeadId: a })).toMatchObject({
      basis: "request_needed",
    })
    const movedRequests = await getLeadSiblingRequests(await signedIn(ADMISSIONS), moved)
    expect(movedRequests.ok && movedRequests.data).toEqual([
      expect.objectContaining({ id: movedId, state: "withdrawn" }),
    ])

    const counts = await requestCounts(year)
    expect(counts.pending.count).toBe(1)
    expect(counts.pending.requests).toEqual([
      {
        requestId: pendingId,
        leadId: pending,
        requestedAt: expect.any(String),
        daysWaiting: 0,
        leadOpen: true,
      },
    ])
    expect(counts.pending.oldestRequestedAt).toBe(counts.pending.requests[0].requestedAt)

    // The Manager's queue lists the same one.
    const queue = await listPendingSiblingRequests(await signedIn(MANAGER))
    if (!queue.ok) throw new Error(`queue failed: ${queue.error}`)
    expect(queue.data.filter((r) => mine.has(r.leadId)).map((r) => r.id)).toEqual([pendingId])

    expect(await explain(pending)).toMatchObject({
      reason: "request_pending",
      becauseOf: [a],
      notes: ["request_pending"],
      pendingRequest: { requestId: pendingId, acrossGroups: false },
    })
    expect(await explain(refused)).toMatchObject({
      reason: "request_refused",
      becauseOf: [a],
    })
    expect(await explain(granted)).toMatchObject({
      reason: "full_payer_sibling",
      becauseOf: [a],
      notes: ["granted"],
    })
    expect(await breaks(year)).toEqual([])
  })
})

describe("permissions", () => {
  test("each count follows its permission; agents and visitors get nothing", async () => {
    const year = await yearWithSchedule()
    const someone = await lead(year, father(), "KG 1")
    const noLeads = await signedIn(
      await createThrowawayStaff(["payments.view", "payments.record", "discounts.approve"]),
    )
    const noPayments = await signedIn(await createThrowawayStaff(["leads.view", "leads.edit", "discounts.approve"]))
    const agent = await signedIn(SEEDED_AGENT)
    const visitor = anonClient()

    for (const caller of [noLeads, agent, visitor]) {
      expect(await getSiblingLeadCounts(caller, year)).toEqual({
        ok: false,
        error: "forbidden",
      })
      expect(await explainSiblingGroup(caller, someone)).toEqual({
        ok: false,
        error: "forbidden",
      })
    }
    for (const caller of [noPayments, agent, visitor]) {
      expect(await getSiblingFeeCounts(caller, year)).toEqual({
        ok: false,
        error: "forbidden",
      })
    }
    // Admissions Staff and the Accountant can't approve discounts.
    for (const caller of [await signedIn(ADMISSIONS), await signedIn(ACCOUNTANT), agent, visitor]) {
      expect(await getSiblingRequestCounts(caller, year)).toEqual({
        ok: false,
        error: "forbidden",
      })
    }

    // Each permission alone is enough for its own reader.
    expect((await getSiblingLeadCounts(noPayments, year)).ok).toBe(true)
    expect((await explainSiblingGroup(noPayments, someone)).ok).toBe(true)
    expect((await getSiblingFeeCounts(noLeads, year)).ok).toBe(true)
    expect((await getSiblingRequestCounts(noLeads, year)).ok).toBe(true)
    expect(await explainSiblingGroup(noPayments, randomUUID())).toEqual({
      ok: false,
      error: "not-found",
    })

    // A lead in no group is explained on its own.
    const read = await explainSiblingGroup(noPayments, someone)
    expect(read.ok && read.data).toMatchObject({
      groupId: null,
      fullPayerLeadId: null,
      members: [
        {
          leadId: someone,
          reason: "on_own",
          result: "none",
          source: "auto",
          becauseOf: [],
          notes: [],
        },
      ],
    })
  })
})

describe("the invariant check", () => {
  test("finds two automatic full payers, a 10% with no counting sibling and an Enrolled result changed without a manual edit", async () => {
    const year = await yearWithSchedule()
    const { dear, cheap, group } = await together(year)
    const lone = await child(year, father(), "STD 2")
    const enrolled = await child(year, father(), "STD 2")
    await payInFull(enrolled)
    expect(await breaks(year)).toEqual([])

    // Each break is made and checked in a transaction that is rolled back.
    const broken = (write: string, params: unknown[]) =>
      inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query(write, params)
        return ours(
          (
            await sql.query<Break>("select kind, group_id, lead_id, detail from public.sibling_invariant_breaks($1)", [
              year,
            ])
          ).rows,
        )
      })

    const twoFull = await broken("update public.lead_sibling_results set result = 'full' where lead_id = $1", [cheap])
    expect(twoFull).toEqual(
      expect.arrayContaining([
        {
          kind: "two_auto_full_payers",
          group_id: group,
          lead_id: null,
          detail: { lead_ids: sorted([dear, cheap]) },
        },
        expect.objectContaining({
          kind: "auto_full_not_full_payer",
          lead_id: cheap,
        }),
      ]),
    )

    const tenAlone = await broken(
      "insert into public.lead_sibling_results (lead_id, result, source, cause) values ($1, 'ten', 'auto', 'sibling')",
      [lone],
    )
    expect(tenAlone).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "ten_without_counting_sibling",
          group_id: null,
          lead_id: lone,
        }),
      ]),
    )

    const changed = await broken(
      "update public.lead_sibling_results set result = 'ten', source = 'auto' where lead_id = $1",
      [enrolled],
    )
    expect(changed).toEqual(
      expect.arrayContaining([
        {
          kind: "enrolled_result_changed",
          group_id: null,
          lead_id: enrolled,
          detail: { locked_result: "full", result: "ten", source: "auto" },
        },
      ]),
    )

    // An Enrolled lead with nothing fixed (explain's `enrolled_unlocked`) and
    // a stored result the rule would not give (`result_out_of_step`): never
    // shown to a person as an explanation, so the check must report both.
    const unlocked = await broken(
      "update public.lead_sibling_results set locked_result = null, locked_at = null, source = 'auto' where lead_id = $1",
      [enrolled],
    )
    expect(unlocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "enrolled_without_lock",
          lead_id: enrolled,
        }),
        expect.objectContaining({
          kind: "result_out_of_step",
          lead_id: enrolled,
        }),
      ]),
    )

    // A full payer that left its group, while a counting member stays: the
    // group must choose again. A group everyone left keeps the pointer
    // harmlessly (a check-in can do that, #305): nothing reads it.
    const leave = `update public.sibling_group_members
                   set group_id = null, basis = null, joined_at = null, sibling_of_lead_id = null, cause = 'sibling_link'
                   where lead_id = any($1::uuid[])`
    const payerLeft = await broken(leave, [[dear]])
    expect(payerLeft).toEqual(
      expect.arrayContaining([
        { kind: "full_payer_not_counting", group_id: group, lead_id: dear, detail: {} },
      ]),
    )
    const emptied = await broken(leave, [[dear, cheap]])
    expect(emptied.filter((b) => b.kind === "full_payer_not_counting")).toEqual([])

    // A manual edit is the one path that may change it.
    const manual = await broken(
      "update public.lead_sibling_results set result = 'ten', source = 'manual' where lead_id = $1",
      [enrolled],
    )
    expect(manual.filter((b) => b.lead_id === enrolled)).toEqual([])
    expect(await breaks(year)).toEqual([])
  })

  test("a group that spans two years is checked whole from either year", async () => {
    const year = await yearWithSchedule()
    const otherYear = await yearWithSchedule()
    const { dear, cheap, group } = await together(year)
    await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [cheap, otherYear]))
    expect(await breaks(year)).toEqual([])
    expect(await breaks(otherYear)).toEqual([])

    for (const checked of [year, otherYear]) {
      const found = await inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.lead_sibling_results set result = 'full' where lead_id = $1", [cheap])
        return ours(
          (
            await sql.query<Break>("select kind, group_id, lead_id, detail from public.sibling_invariant_breaks($1)", [
              checked,
            ])
          ).rows,
        )
      })
      expect(found).toEqual(
        expect.arrayContaining([
          {
            kind: "two_auto_full_payers",
            group_id: group,
            lead_id: null,
            detail: { lead_ids: sorted([dear, cheap]) },
          },
          expect.objectContaining({
            kind: "auto_full_not_full_payer",
            lead_id: cheap,
          }),
        ]),
      )
    }
  })
})
