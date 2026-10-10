import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { decideDiscount, requestDiscount, type DiscountKind } from "@/lib/services/discounts"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { markLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import {
  confirmFamilyMatch,
  createLead,
  getLead,
  recordVisit,
  rejectFamilyMatch,
  separateFromFamily,
  type CreateLeadInput,
  type LeadClass,
  type NewContact,
} from "@/lib/services/leads"
import { adjustPayment } from "@/lib/services/payment-adjustments"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { getPriorSibling, setPriorSibling } from "@/lib/services/sibling-discount"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The Sibling discount within a confirmed Family (#113), through the fees and
// leads modules against local Supabase, signed in as each seeded role. Each
// test makes Families of its own, Passed in a year it claims with a schedule
// of its own (tests/support/fee-years.ts).

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// STD 2 Day: TZS 2,000,000, so 1,800,000 with the Sibling discount.
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

const FULL = 2_000_000
const WITH_SIBLING = 1_800_000

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  // A leading 4 keeps it clear of the seeded 700 000 numbers and of the
  // other test files' numbers.
  return {
    fullName: `Sibling Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `04${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

function student(className: LeadClass) {
  return { fullName: `Sibling ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" as const }
}

async function contactOf(leadId: string): Promise<string> {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`)
  return lead.data.contact.id
}

// Interviewed and Passed today, then moved into `year`.
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

// A Family made at the front desk: one confirmed contact and `size` Passed
// children in `year`, oldest first.
async function family(year: number, size = 2, className: LeadClass = "STD 2"): Promise<string[]> {
  const admissions = await signedIn(ADMISSIONS)
  const ids: string[] = []
  let guardian: CreateLeadInput["guardian"] = { contact: parent() }
  for (let i = 0; i < size; i++) {
    const created = await createLead(admissions, {
      guardian,
      student: student(className),
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
    ids.push(created.data.leadId)
    if (i === 0) guardian = { contactId: await contactOf(created.data.leadId) }
  }
  for (const id of ids) await pass(id, year)
  return ids
}

// A front-desk Family with one Passed child, and a child the Admission form
// sent with the same parent's number, so on its own contact with a pending
// match to the Family. Both Passed in `year`.
async function unconfirmedFamily(year: number): Promise<{ known: string; matched: string }> {
  const [known] = await family(year, 1)
  const contact = await getLead(await signedIn(ADMISSIONS), known)
  if (!contact.ok) throw new Error("setup failed")
  const form = await createLead(secretClient(), {
    guardian: { contact: { fullName: "Typed On The Form", relationship: "Mother", phone: contact.data.contact.phone } },
    student: student("STD 2"),
    start: { kind: "admission-form" },
  })
  if (!form.ok) throw new Error(`setup failed: ${JSON.stringify(form.error)}`)
  const matched = form.data.leadId
  const visited = await recordVisit(await signedIn(ADMISSIONS), matched, today)
  if (!visited.ok) throw new Error(`visit failed: ${JSON.stringify(visited.error)}`)
  await pass(matched, year)
  return { known, matched }
}

async function pay(leadId: string, amount: number, type: PaymentInput["type"] = "initial_deposit") {
  const paid = await recordPayment(await signedIn(ACCOUNTANT), leadId, { type, amount, paidOn: today }, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
  return paid.data.paymentId
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

async function profileOf(leadId: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ sibling_kept: boolean; recompute_cause: string | null }>(
      "select sibling_kept, recompute_cause from public.lead_fee_profiles where lead_id = $1",
      [leadId],
    ),
  )
  return rows[0] ?? null
}

const SIBLING = { kind: "sibling", percent: 10 }

async function grant(leadId: string, kind: DiscountKind) {
  const made = await requestDiscount(await signedIn(ADMISSIONS), leadId, kind, "For the test.", randomUUID())
  if (!made.ok) throw new Error(`request failed: ${JSON.stringify(made.error)}`)
  const decided = await decideDiscount(await signedIn(MANAGER), made.data, { decision: "grant" })
  if (!decided.ok) throw new Error(`grant failed: ${decided.error}`)
}

describe("the Sibling discount in a confirmed Family", () => {
  test("applies once another child is Enrolled, and counts toward the child's own Seat priority", async () => {
    const [first, second] = await family(await yearWithSchedule())
    await pay(second, 720_000)
    expect(await feeOf(second)).toMatchObject({ schoolFee: FULL, discount: null, priority: "Deposit" })

    await pay(first, FULL, "full_payment")
    expect(await statusOf(first)).toBe("Enrolled")
    // 720,000 is 36% of 2,000,000 but 40% of 1,800,000.
    expect(await feeOf(second)).toMatchObject({
      bandFee: FULL,
      schoolFee: WITH_SIBLING,
      discount: SIBLING,
      priority: "First instalment",
      balance: WITH_SIBLING - 720_000,
    })
    expect(await statusOf(second)).toBe("Interviewed")
  })

  test("an unconfirmed Family gives none, and confirming the match gives it", async () => {
    const { known, matched } = await unconfirmedFamily(await yearWithSchedule())
    await pay(known, FULL, "full_payment")
    expect(await statusOf(known)).toBe("Enrolled")
    expect(await feeOf(matched)).toMatchObject({ schoolFee: FULL, discount: null })

    // A tick doesn't count on an unconfirmed Family either.
    expect(await setPriorSibling(await signedIn(ADMISSIONS), matched, { name: "Older Sister", className: "STD 7" })).toEqual({
      ok: true,
      data: null,
    })
    expect(await feeOf(matched)).toMatchObject({ schoolFee: FULL, discount: null })

    expect((await confirmFamilyMatch(await signedIn(ADMISSIONS), matched)).ok).toBe(true)
    expect(await feeOf(matched)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
  })

  test("rejecting a match makes the form's children a Family of their own", async () => {
    const year = await yearWithSchedule()
    const { matched } = await unconfirmedFamily(year)
    // A second child on the form's contact, who pays in full while the match
    // is still pending.
    const formContact = await contactOf(matched)
    const second = await createLead(secretClient(), {
      guardian: { contactId: formContact },
      student: student("STD 2"),
      start: { kind: "admission-form" },
    })
    if (!second.ok) throw new Error("setup failed")
    expect((await recordVisit(await signedIn(ADMISSIONS), second.data.leadId, today)).ok).toBe(true)
    await pass(second.data.leadId, year)
    await pay(second.data.leadId, FULL, "full_payment")
    expect(await statusOf(second.data.leadId)).toBe("Enrolled")
    expect(await feeOf(matched)).toMatchObject({ discount: null })

    expect((await rejectFamilyMatch(await signedIn(ADMISSIONS), matched)).ok).toBe(true)
    expect(await feeOf(matched)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
  })

  test("separating a child from its Family takes the live discount away, and leaves it with the Family's other children", async () => {
    const [enrolled, waiting, separated] = await family(await yearWithSchedule(), 3)
    await pay(enrolled, FULL, "full_payment")
    expect(await feeOf(waiting)).toMatchObject({ discount: SIBLING })
    expect(await feeOf(separated)).toMatchObject({ discount: SIBLING })

    expect((await separateFromFamily(await signedIn(ADMISSIONS), separated)).ok).toBe(true)
    expect(await feeOf(separated)).toMatchObject({ schoolFee: FULL, discount: null })
    expect(await feeOf(waiting)).toMatchObject({ discount: SIBLING })

    // The Enrolled child leaving takes it from the one still waiting.
    expect((await separateFromFamily(await signedIn(ADMISSIONS), enrolled)).ok).toBe(true)
    expect(await feeOf(waiting)).toMatchObject({ schoolFee: FULL, discount: null })
    expect(await statusOf(enrolled)).toBe("Enrolled")
  })
})

describe("the cascade", () => {
  test("enrols a sibling the discount brings over the line; the first child keeps paying the full fee", async () => {
    const [first, second] = await family(await yearWithSchedule())
    await pay(second, WITH_SIBLING)
    expect(await statusOf(second)).toBe("Interviewed")

    await pay(first, FULL, "full_payment")
    expect(await statusOf(first)).toBe("Enrolled")
    expect(await statusOf(second)).toBe("Enrolled")
    expect(await feeOf(second)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING, priority: "Full", balance: 0 })
    expect(await profileOf(second)).toEqual({ sibling_kept: true, recompute_cause: "sibling" })
    // The second child's enrolment doesn't reach back to the first.
    expect(await feeOf(first)).toMatchObject({ schoolFee: FULL, discount: null, balance: 0 })
    expect(await profileOf(first)).toMatchObject({ sibling_kept: false })

    const history = await getLeadHistory(await signedIn(ADMISSIONS), second)
    if (!history.ok) throw new Error(history.error)
    const enrolled = history.data.entries.find(
      (entry) => entry.record === "lead" && entry.changes.some((c) => c.field === "status" && c.to === "Enrolled"),
    )
    expect(enrolled).toBeDefined()
  })

  test("a chain through a larger Family ends, with every child after the first discounted", async () => {
    const children = await family(await yearWithSchedule(), 4)
    // The three younger children have each paid the discounted fee already.
    for (const child of children.slice(1)) await pay(child, WITH_SIBLING)
    expect(new Set(await Promise.all(children.slice(1).map(statusOf)))).toEqual(new Set(["Interviewed"]))

    await pay(children[0], FULL, "full_payment")
    expect(await Promise.all(children.map(statusOf))).toEqual(["Enrolled", "Enrolled", "Enrolled", "Enrolled"])
    expect((await feeOf(children[0])).discount).toBeNull()
    for (const child of children.slice(1)) {
      expect(await feeOf(child)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
      expect(await profileOf(child)).toMatchObject({ sibling_kept: true })
    }
  })

  test("an Enrolled child keeps the discount after the sibling stops being Enrolled; one not yet Enrolled loses it", async () => {
    const [first, kept, waiting] = await family(await yearWithSchedule(), 3)
    await pay(kept, WITH_SIBLING)
    const firstPayment = await pay(first, FULL, "full_payment")
    expect(await statusOf(kept)).toBe("Enrolled")
    expect(await feeOf(waiting)).toMatchObject({ discount: SIBLING })

    const voided = await adjustPayment(
      await signedIn(ACCOUNTANT),
      firstPayment,
      { reason: "Duplicate entry", void: true, note: null },
      randomUUID(),
    )
    expect(voided.ok).toBe(true)
    expect(await statusOf(first)).toBe("Interviewed")
    // Kept by the Enrolled child, and still live for the others, since that
    // child is Enrolled.
    expect(await statusOf(kept)).toBe("Enrolled")
    expect(await feeOf(kept)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING, balance: 0 })
    expect(await feeOf(waiting)).toMatchObject({ discount: SIBLING })

    // Once no child is Enrolled but the one holding it for good, a sibling
    // who isn't Enrolled sees that one and keeps it too; take that one out
    // of the Family and the live discount is gone.
    expect((await separateFromFamily(await signedIn(ADMISSIONS), kept)).ok).toBe(true)
    expect(await feeOf(kept)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
    expect(await feeOf(waiting)).toMatchObject({ schoolFee: FULL, discount: null })
    expect(await feeOf(first)).toMatchObject({ schoolFee: FULL, discount: null })
  })

  test("the first child, taken out of Enrolled while a sibling is Enrolled, counts the live discount again", async () => {
    const [first, second] = await family(await yearWithSchedule())
    await pay(second, WITH_SIBLING)
    const firstPayment = await pay(first, FULL, "full_payment")
    expect(await statusOf(second)).toBe("Enrolled")

    // Corrected down to 1,900,000: short of the full fee, but over the
    // discounted one the first child counts once it is no longer Enrolled.
    const corrected = await adjustPayment(
      await signedIn(ACCOUNTANT),
      firstPayment,
      { reason: "Data-entry correction", void: false, type: "full_payment", amount: 1_900_000, paidOn: today, note: null },
      randomUUID(),
    )
    expect(corrected.ok).toBe(true)
    expect(await statusOf(first)).toBe("Enrolled")
    expect(await feeOf(first)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
    expect(await profileOf(first)).toMatchObject({ sibling_kept: true })
  })
})

describe("the prior-sibling tick", () => {
  test("gives a lone child the discount, shows on the lead, and clears", async () => {
    const [child] = await family(await yearWithSchedule(), 1)
    const admissions = await signedIn(ADMISSIONS)
    expect(await getPriorSibling(admissions, child)).toEqual({ ok: true, data: null })

    expect(await setPriorSibling(admissions, child, { name: "  Amina Older  ", className: "STD 6" })).toEqual({ ok: true, data: null })
    expect(await getPriorSibling(await signedIn(ACCOUNTANT), child)).toEqual({
      ok: true,
      data: { name: "Amina Older", className: "STD 6" },
    })
    expect(await feeOf(child)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
    expect(await profileOf(child)).toMatchObject({ recompute_cause: null })

    // The same tick again changes nothing.
    const before = await getLeadHistory(admissions, child)
    expect(await setPriorSibling(admissions, child, { name: "Amina Older", className: "STD 6" })).toEqual({ ok: true, data: null })
    const after = await getLeadHistory(admissions, child)
    expect(after.ok && after.data.entries.length).toBe(before.ok && before.data.entries.length)

    expect(await setPriorSibling(admissions, child, null)).toEqual({ ok: true, data: null })
    expect(await getPriorSibling(admissions, child)).toEqual({ ok: true, data: null })
    expect(await feeOf(child)).toMatchObject({ schoolFee: FULL, discount: null })
  })

  test("a tick that brings the fee down to what was paid enrols the child, which then keeps it", async () => {
    const [child] = await family(await yearWithSchedule(), 1)
    await pay(child, WITH_SIBLING)
    expect(await statusOf(child)).toBe("Interviewed")

    expect((await setPriorSibling(await signedIn(ADMISSIONS), child, { name: "Older Brother", className: "FORM 2" })).ok).toBe(true)
    expect(await statusOf(child)).toBe("Enrolled")
    expect(await profileOf(child)).toEqual({ sibling_kept: true, recompute_cause: "prior_sibling" })

    // Cleared by mistake afterwards: Enrolled holding it, the child keeps it.
    expect((await setPriorSibling(await signedIn(ADMISSIONS), child, null)).ok).toBe(true)
    expect(await feeOf(child)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
    expect(await statusOf(child)).toBe("Enrolled")
  })

  test("refuses a blank name, an unknown class, a closed lead, staff without leads.edit and visitors", async () => {
    const year = await yearWithSchedule()
    const [child, closed] = await family(year, 2)
    const admissions = await signedIn(ADMISSIONS)
    expect(await setPriorSibling(admissions, child, { name: "  ", className: "STD 6" })).toEqual({ ok: false, error: "invalid-name" })
    expect(await setPriorSibling(admissions, child, { name: "x".repeat(201), className: "STD 6" })).toEqual({
      ok: false,
      error: "invalid-name",
    })
    expect(await setPriorSibling(admissions, child, { name: "Amina", className: "STD 9" as LeadClass })).toEqual({
      ok: false,
      error: "invalid-class",
    })
    expect(await setPriorSibling(await signedIn(ACCOUNTANT), child, { name: "Amina", className: "STD 6" })).toEqual({
      ok: false,
      error: "forbidden",
    })
    expect(await setPriorSibling(anonClient(), child, { name: "Amina", className: "STD 6" })).toEqual({ ok: false, error: "forbidden" })
    expect(await setPriorSibling(admissions, randomUUID(), { name: "Amina", className: "STD 6" })).toEqual({
      ok: false,
      error: "not-found",
    })

    expect((await markLead(await signedIn(MANAGER), closed, { mark: "archived", reason: "Admission cycle ended" })).ok).toBe(true)
    expect(await setPriorSibling(admissions, closed, { name: "Amina", className: "STD 6" })).toEqual({ ok: false, error: "lead-closed" })
    expect(await getPriorSibling(anonClient(), child)).toEqual({ ok: true, data: null })
  })
})

describe("the largest discount wins", () => {
  test("Staff child and Qualified orphan over Sibling", async () => {
    const year = await yearWithSchedule()
    const [first, second, third] = await family(year, 3)
    await pay(first, FULL, "full_payment")
    expect(await feeOf(second)).toMatchObject({ discount: SIBLING })

    await grant(second, "staff_child")
    expect(await feeOf(second)).toMatchObject({ schoolFee: 1_500_000, discount: { kind: "staff_child", percent: 25 } })
    await grant(third, "qualified_orphan")
    expect(await feeOf(third)).toMatchObject({ schoolFee: 0, discount: { kind: "qualified_orphan", percent: 100 } })
  })
})

describe("concurrency", () => {
  test("two payments in one Family recorded at once end consistent", async () => {
    const year = await yearWithSchedule()
    const families = await Promise.all([family(year), family(year), family(year)])
    const accountant = await signedIn(ACCOUNTANT)
    const outcomes = await Promise.all(
      families.flatMap(([first, second]) => [
        recordPayment(accountant, first, { type: "full_payment", amount: FULL, paidOn: today }, randomUUID()),
        recordPayment(accountant, second, { type: "first_instalment", amount: WITH_SIBLING, paidOn: today }, randomUUID()),
      ]),
    )
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true)

    for (const [first, second] of families) {
      expect([await statusOf(first), await statusOf(second)]).toEqual(["Enrolled", "Enrolled"])
      expect(await feeOf(first)).toMatchObject({ schoolFee: FULL, discount: null })
      expect(await feeOf(second)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
      expect(await profileOf(second)).toMatchObject({ sibling_kept: true })
    }
  })
})
