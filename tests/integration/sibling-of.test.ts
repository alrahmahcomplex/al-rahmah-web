import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, getLead, type LeadClass, type NewContact } from "@/lib/services/leads"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { linkSibling, type LinkSiblingInput } from "@/lib/services/sibling-groups"

import { anonClient, asSystem, inRolledBackTransaction, lockExclusively, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// "Sibling of" linking and the new Sibling fee rule (#301), through the
// services and the database functions against local Supabase. Each test makes
// its own families in a year it claims. The fathers' names come from the
// students' names: "Amina Juma Hassan" has the father "Juma Hassan".

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// Day fees: KG 1 1,100,000; STD 2 2,000,000; STD 6 2,100,000; FORM 1 2,800,000.
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

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  // A leading 05 keeps it clear of the seeded numbers and the other sibling suites.
  return {
    fullName: `Sibling Of Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

// A father's name of two words no other test uses.
function father(): string {
  const word = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "a")
  return `F${word()} H${word()}`
}

async function contactOf(leadId: string): Promise<string> {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`)
  return lead.data.contact.id
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

// A Passed child in `year`, on a new contact or on `contactId`.
async function child(year: number, fatherName: string, className: LeadClass, contactId?: string): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: contactId ? { contactId } : { contact: parent() },
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

async function pay(leadId: string, amount: number, type: PaymentInput["type"] = "full_payment") {
  const paid = await recordPayment(await signedIn(ACCOUNTANT), leadId, { type, amount, paidOn: today }, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
}

async function payInFull(leadId: string) {
  await pay(leadId, (await feeOf(leadId)).schoolFee)
}

async function statusOf(leadId: string) {
  const lead = await getLead(await signedIn(ADMISSIONS), leadId)
  if (!lead.ok) throw new Error(`no lead: ${lead.error}`)
  return lead.data.status
}

async function feeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data
}

type Stored = { result: string; source: string; locked_result: string | null; cause: string | null }

async function resultOf(leadId: string, sql?: Client): Promise<Stored> {
  const read = async (client: Client) =>
    (
      await client.query<Stored>(
        `select coalesce(r.result::text, 'none') as result, coalesce(r.source::text, 'auto') as source,
                r.locked_result::text as locked_result, r.cause
         from (select 1) one left join public.lead_sibling_results r on r.lead_id = $1`,
        [leadId],
      )
    ).rows[0]
  return sql ? read(sql) : inRolledBackTransaction(read)
}

type Membership = { group_id: string | null; legacy: boolean; basis: string | null; sibling_of_lead_id: string | null } | null

async function membershipOf(leadId: string): Promise<Membership> {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<NonNullable<Membership>>(
          "select group_id, legacy, basis, sibling_of_lead_id from public.sibling_group_members where lead_id = $1",
          [leadId],
        )
      ).rows[0] ?? null,
  )
}

async function fullPayerOf(groupId: string): Promise<string | null> {
  return inRolledBackTransaction(
    async (sql) => (await sql.query("select full_payer_lead_id from public.sibling_groups where id = $1", [groupId])).rows[0].full_payer_lead_id,
  )
}

async function fatherOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query("select father_full_name as name, father_full_name_source as source from public.leads where id = $1", [leadId]))
        .rows[0] as { name: string | null; source: string | null },
  )
}

// Links `later` to `first` on another contact, with the same father: two
// children registered together. Returns the group.
async function together(first: string, later: string): Promise<string> {
  const linked = await link({ leadId: later, siblingOfLeadId: first })
  if (linked.kind !== "linked") throw new Error(`not linked: ${JSON.stringify(linked)}`)
  expect(linked.basis).toBe("matched")
  return linked.groupId
}

describe("the owner's two examples", () => {
  test.each([["the cheaper child pays first"], ["the dearer child pays first"]])(
    "siblings registered together: the dearer child pays full and the cheaper gets 10% at once, when %s",
    async (order) => {
      const year = await yearWithSchedule()
      const name = father()
      const dear = await child(year, name, "STD 2")
      const cheap = await child(year, name, "KG 1")
      const group = await together(dear, cheap)

      expect(await fullPayerOf(group)).toBe(dear)
      expect(await feeOf(dear)).toMatchObject({ schoolFee: STD2, discount: null })
      expect(await feeOf(cheap)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })

      const [first, second] = order === "the cheaper child pays first" ? [cheap, dear] : [dear, cheap]
      await payInFull(first)
      expect(await statusOf(first)).toBe("Enrolled")
      await payInFull(second)
      expect(await statusOf(second)).toBe("Enrolled")

      expect(await resultOf(dear)).toMatchObject({ result: "full", locked_result: "full" })
      expect(await resultOf(cheap)).toMatchObject({ result: "ten", locked_result: "ten" })
      expect(await feeOf(dear)).toMatchObject({ schoolFee: STD2 })
      expect(await feeOf(cheap)).toMatchObject({ schoolFee: tenOff(KG1) })
    },
  )

  test("January and April: the child Enrolled at full alone keeps its fee, and the dearer sibling linked later gets 10%", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const january = await child(year, name, "KG 1")
    await payInFull(january)
    expect(await statusOf(january)).toBe("Enrolled")
    expect(await resultOf(january)).toMatchObject({ result: "full", locked_result: "full" })

    const april = await child(year, name, "FORM 1")
    expect(await feeOf(april)).toMatchObject({ schoolFee: FORM1, discount: null })
    await together(january, april)

    expect(await feeOf(april)).toMatchObject({ schoolFee: tenOff(FORM1), discount: SIBLING })
    expect(await resultOf(april)).toMatchObject({ result: "ten", source: "auto" })
    expect(await feeOf(january)).toMatchObject({ schoolFee: KG1, discount: null })
    expect(await resultOf(january)).toMatchObject({ result: "full", locked_result: "full" })
  })
})

describe("the full payer", () => {
  test("a dearer sibling registered after the full payer was chosen gets 10%, and the full payer keeps full", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const first = await child(year, name, "STD 2")
    const second = await child(year, name, "KG 1")
    const group = await together(first, second)
    expect(await fullPayerOf(group)).toBe(first)

    const later = await child(year, name, "FORM 1")
    expect(await link({ leadId: later, siblingOfLeadId: second })).toMatchObject({ kind: "linked", basis: "matched", groupId: group })

    expect(await fullPayerOf(group)).toBe(first)
    expect(await feeOf(first)).toMatchObject({ schoolFee: STD2, discount: null })
    expect(await feeOf(later)).toMatchObject({ schoolFee: tenOff(FORM1), discount: SIBLING })
    expect(await feeOf(second)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })
  })

  test("a Declined full payer: a new one is chosen among the members not yet Enrolled, and Enrolled fees stay", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const dear = await child(year, name, "FORM 1")
    const middle = await child(year, name, "STD 2")
    const cheap = await child(year, name, "KG 1")
    const group = await together(dear, middle)
    await link({ leadId: cheap, siblingOfLeadId: dear })
    expect(await fullPayerOf(group)).toBe(dear)

    await payInFull(cheap)
    expect(await resultOf(cheap)).toMatchObject({ result: "ten", locked_result: "ten" })

    const declined = await declineLead(await signedIn(MANAGER), dear, { reason: "Other", explanation: "For the test." })
    expect(declined.ok).toBe(true)

    expect(await fullPayerOf(group)).toBe(middle)
    expect(await feeOf(middle)).toMatchObject({ schoolFee: STD2, discount: null })
    expect(await feeOf(cheap)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })
    expect(await resultOf(cheap)).toMatchObject({ result: "ten", locked_result: "ten" })
  })

  test("two links into one group at once are taken in turn: one full payer, never two", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const first = await child(year, name, "KG 1")
    const second = await child(year, name, "STD 2")
    const third = await child(year, name, "FORM 1")
    const [a, b] = await Promise.all([
      link({ leadId: second, siblingOfLeadId: first }),
      link({ leadId: third, siblingOfLeadId: first }),
    ])
    expect(a).toMatchObject({ kind: "linked", basis: "matched" })
    expect(b).toMatchObject({ kind: "linked", basis: "matched" })
    const group = (a as { groupId: string }).groupId
    expect((b as { groupId: string }).groupId).toBe(group)

    const payer = await fullPayerOf(group)
    const results = await Promise.all([first, second, third].map((id) => resultOf(id)))
    expect(results.filter((r) => r.result === "full")).toHaveLength(1)
    expect(results.filter((r) => r.result === "ten")).toHaveLength(2)
    expect(payer).not.toBe(first)
  })
})

describe("the father's-name check", () => {
  test("a close name asks the question and saves nothing; a typing mistake writes the spelling to every member holding the other one", async () => {
    const year = await yearWithSchedule()
    const stem = father()
    const right = `Mohamed ${stem}`
    const first = await child(year, right, "STD 2")
    const second = await child(year, right, "STD 2", await contactOf(first))
    // The second child's record holds the wrong spelling (legacy group on one contact).
    await link({ leadId: second, siblingOfLeadId: first, siblingFatherFullName: right })
    const typo = await child(year, `Mohammed ${stem}`, "KG 1")

    const asked = await link({ leadId: typo, siblingOfLeadId: first })
    expect(asked).toEqual({
      kind: "name-question",
      fatherFullName: `Mohammed ${stem}`,
      siblingLeadId: expect.any(String),
      siblingFatherFullName: right,
    })
    expect(await membershipOf(typo)).toBeNull()

    // A spelling that is neither name is refused.
    const wrong = await linkSibling(await signedIn(ADMISSIONS), { leadId: typo, siblingOfLeadId: first, answer: "typo", spelling: "Someone Else" })
    expect(wrong).toEqual({ ok: false, error: { kind: "invalid", field: "spelling" } })

    const answered = await link({ leadId: typo, siblingOfLeadId: first, answer: "typo", spelling: `Mohammed ${stem}` })
    expect(answered).toMatchObject({ kind: "linked", basis: "typo_confirmed" })
    for (const id of [first, second, typo]) {
      expect(await fatherOf(id)).toEqual({ name: `Mohammed ${stem}`, source: id === typo ? "derived" : "typo_confirmed" })
    }
    expect(await membershipOf(first)).toMatchObject({ basis: "matched" })
    expect(await membershipOf(second)).toMatchObject({ basis: "matched" })
    expect(await feeOf(typo)).toMatchObject({ discount: SIBLING })

    const history = await inRolledBackTransaction(
      async (sql) =>
        (
          await sql.query<{ n: number }>(
            "select count(*)::int as n from public.audit_log where table_name = 'leads' and lead_id = $1 and action = 'update' and actor_kind = 'staff'",
            [first],
          )
        ).rows[0].n,
    )
    expect(history).toBeGreaterThan(0)
  })

  test("two different names answered as different, or completely different names: a request is needed and no 10%", async () => {
    const year = await yearWithSchedule()
    const first = await child(year, "Juma Hassan", "STD 2")
    const closeOne = await child(year, "Jumaa Hassan", "KG 1")
    const different = await child(year, father(), "KG 1")
    const group = await together(first, await child(year, "Juma Hassan", "STD 2"))

    expect(await link({ leadId: closeOne, siblingOfLeadId: first, answer: "different" })).toMatchObject({
      kind: "linked",
      basis: "request_needed",
      groupId: group,
    })
    expect(await link({ leadId: different, siblingOfLeadId: first })).toMatchObject({ kind: "linked", basis: "request_needed" })
    expect(await feeOf(closeOne)).toMatchObject({ schoolFee: KG1, discount: null })
    expect(await feeOf(different)).toMatchObject({ schoolFee: KG1, discount: null })
    expect(await fatherOf(first)).toEqual({ name: "Juma Hassan", source: "derived" })
  })

  test("editing a name from different to the same does not link without a granted request, on either edit path", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const first = await child(year, name, "STD 2")
    const other = await child(year, father(), "KG 1")
    await link({ leadId: other, siblingOfLeadId: first })
    expect(await membershipOf(other)).toMatchObject({ basis: "request_needed" })

    const admissions = await signedIn(ADMISSIONS)
    const edited = await admissions.rpc("update_lead_details", { lead_id: other, changes: { father_full_name: name } })
    expect(edited.error).toBeNull()
    expect(await fatherOf(other)).toEqual({ name, source: "edited" })
    expect(await membershipOf(other)).toMatchObject({ basis: "request_needed" })
    expect(await feeOf(other)).toMatchObject({ schoolFee: KG1, discount: null })

    // A third child whose student-name correction re-derives the father's name.
    const third = await child(year, father(), "KG 1")
    await link({ leadId: third, siblingOfLeadId: first })
    const renamed = await admissions.rpc("update_lead_details", { lead_id: third, changes: { full_name: `Renamed ${name}` } })
    expect(renamed.error).toBeNull()
    expect(await fatherOf(third)).toEqual({ name, source: "derived" })
    expect(await membershipOf(third)).toMatchObject({ basis: "request_needed" })
    expect(await feeOf(third)).toMatchObject({ discount: null })
  })

  test("a lead waiting on a request stays waiting when it is linked again elsewhere, after its name was made the same", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const dear = await child(year, name, "FORM 1")
    const waiting = await child(year, father(), "KG 1")
    await together(dear, await child(year, name, "STD 2"))
    await link({ leadId: waiting, siblingOfLeadId: dear })
    expect(await membershipOf(waiting)).toMatchObject({ basis: "request_needed" })

    const admissions = await signedIn(ADMISSIONS)
    expect((await admissions.rpc("update_lead_details", { lead_id: waiting, changes: { father_full_name: name } })).error).toBeNull()

    // Linked to an ungrouped child of the same father, it would bring its
    // group along: refused, since it still waits on a request. Nothing moves.
    const loose = await child(year, name, "STD 2")
    const group = (await membershipOf(waiting))?.group_id
    expect(await linkSibling(admissions, { leadId: waiting, siblingOfLeadId: loose })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "sibling_of" },
    })
    expect(await membershipOf(waiting)).toMatchObject({ group_id: group, basis: "request_needed" })
    expect(await membershipOf(loose)).toBeNull()
    expect(await feeOf(waiting)).toMatchObject({ schoolFee: KG1, discount: null })

    // A waiting lead alone in its group moves, still waiting.
    const alone = await child(year, father(), "KG 1")
    const first = await child(year, father(), "STD 2")
    await link({ leadId: alone, siblingOfLeadId: first })
    // Its only sibling leaves the group (as an unlink will).
    await asSystem(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(
        "update public.sibling_group_members set group_id = null, basis = null, joined_at = null, cause = 'family' where lead_id = $1",
        [first],
      )
    })
    expect((await admissions.rpc("update_lead_details", { lead_id: alone, changes: { father_full_name: name } })).error).toBeNull()
    expect(await link({ leadId: alone, siblingOfLeadId: dear })).toMatchObject({ kind: "linked", basis: "request_needed" })
    expect(await feeOf(alone)).toMatchObject({ schoolFee: KG1, discount: null })
  })

  test("a linked member's correction: different takes the 10% away, close asks the question first", async () => {
    const year = await yearWithSchedule()
    const stem = father()
    const first = await child(year, `Juma ${stem}`, "STD 2")
    const second = await child(year, `Juma ${stem}`, "KG 1")
    await together(first, second)
    expect(await feeOf(second)).toMatchObject({ discount: SIBLING })
    const admissions = await signedIn(ADMISSIONS)

    // A student-name correction that would make the father close: asked, nothing saved.
    const before = await fatherOf(second)
    const asked = await admissions.rpc("update_lead_details", { lead_id: second, changes: { full_name: `Kidx Jumaa ${stem}` } })
    expect(asked.error?.message).toBe("father_name_question")
    expect(JSON.parse(asked.error!.details!)).toEqual({
      father_full_name: `Jumaa ${stem}`,
      sibling_lead_id: first,
      sibling_father_full_name: `Juma ${stem}`,
    })
    expect(await fatherOf(second)).toEqual(before)

    // Answered as a typing mistake, keeping the sibling's spelling.
    const typo = await admissions.rpc("update_lead_details", {
      lead_id: second,
      changes: { full_name: `Kidx Jumaa ${stem}`, father_name_answer: "typo", father_name_spelling: `Juma ${stem}` },
    })
    expect(typo.error).toBeNull()
    expect(await fatherOf(second)).toEqual({ name: `Juma ${stem}`, source: "typo_confirmed" })
    expect(await membershipOf(second)).toMatchObject({ basis: "typo_confirmed" })
    expect(await feeOf(second)).toMatchObject({ discount: SIBLING })

    // A completely different father: the member needs a request, and the 10% goes.
    const changed = await admissions.rpc("update_lead_details", { lead_id: second, changes: { father_full_name: father() } })
    expect(changed.error).toBeNull()
    expect(await membershipOf(second)).toMatchObject({ basis: "request_needed" })
    expect(await feeOf(second)).toMatchObject({ schoolFee: KG1, discount: null })
  })
})

describe("legacy members", () => {
  test("a legacy member leaving legacy keeps its 10%, flagged for the Accountant", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const enrolled = await child(year, name, "STD 2")
    const waiting = await child(year, name, "KG 1", await contactOf(enrolled))
    await payInFull(enrolled)
    expect(await resultOf(waiting)).toMatchObject({ result: "ten", source: "auto" })
    expect(await membershipOf(waiting)).toMatchObject({ legacy: true })

    // Linked to a child of another father on another contact: it leaves its
    // Family's group and needs a request, which would take its 10% away.
    const elsewhere = await child(year, father(), "STD 2")
    expect(await link({ leadId: waiting, siblingOfLeadId: elsewhere })).toMatchObject({ kind: "linked", basis: "request_needed" })

    expect(await resultOf(waiting)).toMatchObject({ result: "ten", source: "legacy", cause: "left_legacy" })
    expect(await feeOf(waiting)).toMatchObject({ schoolFee: tenOff(KG1), discount: SIBLING })
    // It stays kept when the group changes again.
    await payInFull(elsewhere)
    expect(await resultOf(waiting)).toMatchObject({ result: "ten", source: "legacy" })
  })

  test("linking to a legacy member asks for its father's name first, and a match keeps the 10% with no flag", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const enrolled = await child(year, name, "STD 2")
    const waiting = await child(year, name, "KG 1", await contactOf(enrolled))
    await payInFull(enrolled)

    expect(await link({ leadId: waiting, siblingOfLeadId: enrolled })).toEqual({ kind: "sibling-father-name-needed", leadId: enrolled })
    expect(await link({ leadId: waiting, siblingOfLeadId: enrolled, siblingFatherFullName: name })).toMatchObject({
      kind: "linked",
      basis: "matched",
    })
    expect(await membershipOf(enrolled)).toMatchObject({ legacy: false, basis: "matched" })
    expect(await fatherOf(enrolled)).toEqual({ name, source: "derived" })
    expect(await resultOf(waiting)).toMatchObject({ result: "ten", source: "auto" })
    expect(await feeOf(enrolled)).toMatchObject({ schoolFee: STD2 })
  })
})

describe("groups", () => {
  test("merging two groups: one group, one full payer, the recompute ends and Enrolled fees stay", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const a = await child(year, name, "STD 2")
    const b = await child(year, name, "KG 1")
    const c = await child(year, name, "FORM 1")
    const d = await child(year, name, "KG 1")
    const left = await together(a, b)
    const right = await together(c, d)
    await payInFull(d)
    expect(await resultOf(d)).toMatchObject({ locked_result: "ten" })

    const merged = await link({ leadId: b, siblingOfLeadId: c })
    expect(merged).toMatchObject({ kind: "linked", basis: "matched", groupId: right })
    for (const id of [a, b, c, d]) expect((await membershipOf(id))?.group_id).toBe(right)
    expect(await fullPayerOf(left)).toBeNull()
    // The dearer of the two full payers keeps the place; the other is a later sibling.
    expect(await fullPayerOf(right)).toBe(c)
    expect(await feeOf(c)).toMatchObject({ schoolFee: FORM1, discount: null })
    expect(await feeOf(a)).toMatchObject({ schoolFee: tenOff(STD2), discount: SIBLING })
    expect(await feeOf(d)).toMatchObject({ schoolFee: tenOff(KG1) })
  })

  test("a group across two contacts takes both Family locks before anything else", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const first = await child(year, name, "STD 2")
    const second = await child(year, name, "KG 1")
    await together(first, second)
    const otherContact = await contactOf(first)

    await inRolledBackTransaction(async (holder) => {
      await holder.query("select pg_advisory_xact_lock(hashtext('lead_family'), hashtext($1))", [otherContact])
      const paying = payInFull(second)
      for (let tries = 0; ; tries++) {
        const { rows } = await holder.query<{ n: number }>(
          `select count(*)::int as n from pg_locks
           where locktype = 'advisory' and not granted and classid::int = hashtext('lead_family') and objid::int = hashtext($1)`,
          [otherContact],
        )
        if (rows[0].n > 0) break
        if (tries > 100) throw new Error("the payment never waited")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      // It holds no row of the lead while it waits.
      const free = await inRolledBackTransaction(async (other) => {
        await other.query("set local lock_timeout = '200ms'")
        return (await other.query("select id from public.leads where id = $1 for update", [second])).rowCount
      })
      expect(free).toBe(1)
      await holder.query("rollback")
      await holder.query("begin")
      await paying
    })
    expect(await statusOf(second)).toBe("Enrolled")
  })

  test("the kill switch holds back the 10% at once, and resuming gives it", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const dear = await child(year, name, "STD 2")
    const cheap = await child(year, name, "KG 1")
    const group = await together(dear, cheap)

    // The switch is global, so the run stays in one transaction that is
    // rolled back. The 10% is taken back first, as if the link came while
    // new grants were paused.
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_sibling_grants_paused(true)")
      await sql.query("update public.lead_sibling_results set result = 'none' where lead_id = $1", [cheap])
      await sql.query("select public.recompute_sibling_group($1, 'sibling')", [group])
      expect(await resultOf(cheap, sql)).toMatchObject({ result: "none" })
      expect(await resultOf(dear, sql)).toMatchObject({ result: "full" })

      await sql.query("select public.set_sibling_grants_paused(false)")
      expect(await resultOf(cheap, sql)).toMatchObject({ result: "ten", source: "auto" })
    })
  })
})

describe("who may link", () => {
  test("needs leads.edit, an open lead and two different leads", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const first = await child(year, name, "STD 2")
    const second = await child(year, name, "KG 1")

    expect(await linkSibling(anonClient(), { leadId: second, siblingOfLeadId: first })).toEqual({ ok: false, error: { kind: "forbidden" } })
    expect(await linkSibling(await signedIn(ACCOUNTANT), { leadId: second, siblingOfLeadId: first })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
    expect(await linkSibling(await signedIn(ADMISSIONS), { leadId: first, siblingOfLeadId: first })).toEqual({
      ok: false,
      error: { kind: "invalid", field: "sibling_of" },
    })
    expect(await linkSibling(await signedIn(ADMISSIONS), { leadId: randomUUID(), siblingOfLeadId: first })).toEqual({
      ok: false,
      error: { kind: "not-found" },
    })

    expect((await declineLead(await signedIn(MANAGER), first, { reason: "Other", explanation: "For the test." })).ok).toBe(true)
    expect(await linkSibling(await signedIn(ADMISSIONS), { leadId: second, siblingOfLeadId: first })).toEqual({
      ok: false,
      error: { kind: "lead-closed" },
    })
    expect(await membershipOf(second)).toBeNull()
  })
})

describe("migration day", () => {
  test("every lead gets the Family rule's answer, and the snapshot check raises when a fee moves", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const enrolled = await child(year, name, "STD 2")
    const waiting = await child(year, name, "KG 1", await contactOf(enrolled))
    await payInFull(enrolled)

    await inRolledBackTransaction(async (sql) => {
      // No other suite writes a fee between the two snapshots.
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
      await sql.query("create temp table sibling_of_before as select * from public.fee_snapshot()")
      // The groups' contacts rebuilt as the migration builds them.
      await sql.query("update public.sibling_groups set contact_ids = '{}'")
      await sql.query("select public.refresh_sibling_group_contacts(id) from public.sibling_groups")
      const legacyOnly = await sql.query(
        `select l.id from public.leads l
         join public.sibling_group_members m on m.lead_id = l.id
         join public.sibling_groups g on g.id = m.group_id
         where m.legacy and not exists (select 1 from public.sibling_group_members o where o.group_id = g.id and not o.legacy)
           and (select (r.result, r.source) from public.sibling_rule_result(l.id) r)
               is distinct from (select (f.result, f.source) from public.sibling_rule_result_by_family(l.id) f)`,
      )
      expect(legacyOnly.rows).toEqual([])
      await sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.sibling_of_before')")

      await sql.query("update public.lead_sibling_results set result = 'none', source = 'auto' where lead_id = $1", [waiting])
      await expect(sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.sibling_of_before')")).rejects.toThrow(
        /fee_snapshot_changed/,
      )
    })
  })
})
