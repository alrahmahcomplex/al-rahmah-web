import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { correctFatherFullName, correctPreviousSchool, getLeadFatherAndSchool } from "@/lib/services/lead-details"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, type LeadClass, type NewContact } from "@/lib/services/leads"
import { explainSiblingGroup, getFullPayerTie } from "@/lib/services/sibling-counts"
import { linkSibling, type LinkSiblingInput } from "@/lib/services/sibling-groups"
import { decideSiblingRequest, getLeadSiblingRequests, previewSiblingGrant, requestSiblingDiscount } from "@/lib/services/sibling-requests"

import { asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The lead record's Sibling screens (#310): the Manager's preview of a
// grant, the full payer's tie, and the father's-name and previous-school
// corrections, through the services against local Supabase. Each test makes
// its own families in a year it claims. "Kid Juma Hassan" has the father
// "Juma Hassan".

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
const tenOff = (fee: number) => fee - fee / 10

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  return {
    fullName: `Sibling Record Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

// A father's name of two seven-letter words no other test uses.
function father(): string {
  const word = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "a")
  return `R${word()} Q${word()}`
}

// One letter changed in the last word: close to `name`, not the same.
const close = (name: string) => name.slice(0, -1) + (name.endsWith("z") ? "y" : "z")

async function child(year: number, fatherName: string, className: LeadClass): Promise<string> {
  const admissions = await signedIn(ADMISSIONS)
  const created = await createLead(admissions, {
    guardian: { contact: parent() },
    student: { fullName: `Kid${randomUUID().slice(0, 6)} ${fatherName}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(admissions, created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  const recorded = await recordInterviewResult(admissions, registered.data.interviewId, { interviewDate: today, result: "Passed", score: 80 })
  if (!recorded.ok) throw new Error(`result failed: ${recorded.error}`)
  await asSystem((sql) => sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, year]))
  return created.data.leadId
}

async function link(input: LinkSiblingInput) {
  const linked = await linkSibling(await signedIn(ADMISSIONS), input)
  if (!linked.ok) throw new Error(`link failed: ${JSON.stringify(linked.error)}`)
  return linked.data
}

async function pair(year: number, name: string, first: LeadClass, second: LeadClass) {
  const a = await child(year, name, first)
  const b = await child(year, name, second)
  expect(await link({ leadId: b, siblingOfLeadId: a })).toMatchObject({ kind: "linked", basis: "matched" })
  return { a, b }
}

async function basisOf(leadId: string) {
  return inRolledBackTransaction(
    async (sql) =>
      (await sql.query<{ basis: string | null }>("select basis::text as basis from public.sibling_group_members where lead_id = $1", [leadId]))
        .rows[0]?.basis ?? null,
  )
}

async function schoolFeeOf(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  return fee.data.schoolFee
}

describe("preview_sibling_grant", () => {
  test("shows the group as a grant would leave it, with the fees that move, and saves nothing", async () => {
    const year = await yearWithSchedule()
    const { a: dear } = await pair(year, father(), "FORM 1", "STD 2")
    const waiting = await child(year, father(), "KG 1")
    expect(await link({ leadId: waiting, siblingOfLeadId: dear })).toMatchObject({ kind: "linked", basis: "request_needed" })
    const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), {
      leadId: waiting,
      note: "Both birth certificates on Thursday.",
      requestId: randomUUID(),
    })
    if (!asked.ok) throw new Error(`request failed: ${JSON.stringify(asked.error)}`)

    const preview = await previewSiblingGrant(await signedIn(MANAGER), asked.data)
    expect(preview.ok).toBe(true)
    if (!preview.ok) return
    const member = preview.data.explanation?.members.find((m) => m.leadId === waiting)
    expect(member).toMatchObject({ basis: "granted", reason: "full_payer_sibling", becauseOf: [dear], result: "ten" })
    expect(preview.data.explanation?.members.find((m) => m.leadId === dear)).toMatchObject({ reason: "full_payer", highestFee: true })
    expect(preview.data.fullPayerTie).toBe(false)
    expect(preview.data.changes).toEqual([{ leadId: waiting, before: KG1, after: tenOff(KG1) }])

    // Nothing was saved: the request still waits, and the fee and basis are as before.
    expect(await basisOf(waiting)).toBe("request_needed")
    expect(await schoolFeeOf(waiting)).toBe(KG1)
    const requests = await getLeadSiblingRequests(await signedIn(ADMISSIONS), waiting)
    expect(requests.ok && requests.data.map((r) => r.state)).toEqual(["pending"])
  })

  test("is refused to staff who may not decide discounts, and for a request already decided", async () => {
    const year = await yearWithSchedule()
    const { a } = await pair(year, father(), "STD 2", "STD 2")
    const waiting = await child(year, father(), "KG 1")
    await link({ leadId: waiting, siblingOfLeadId: a })
    const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), { leadId: waiting, note: "Proof.", requestId: randomUUID() })
    if (!asked.ok) throw new Error("request failed")

    expect(await previewSiblingGrant(await signedIn(ADMISSIONS), asked.data)).toEqual({ ok: false, error: "forbidden" })
    expect(await previewSiblingGrant(await signedIn(ACCOUNTANT), asked.data)).toEqual({ ok: false, error: "forbidden" })
    expect(await previewSiblingGrant(await signedIn(MANAGER), randomUUID())).toEqual({ ok: false, error: "not-found" })

    const refused = await decideSiblingRequest(await signedIn(MANAGER), asked.data, { decision: "refuse", reason: "Two mothers." })
    expect(refused.ok).toBe(true)
    expect(await previewSiblingGrant(await signedIn(MANAGER), asked.data)).toEqual({ ok: false, error: "not-pending" })
  })
})

describe("preview_sibling_grant for a role without leads.view", () => {
  test("shows the fees that move but no group, and still saves nothing", async () => {
    const year = await yearWithSchedule()
    const { a: dear } = await pair(year, father(), "FORM 1", "STD 2")
    const waiting = await child(year, father(), "KG 1")
    await link({ leadId: waiting, siblingOfLeadId: dear })
    const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), { leadId: waiting, note: "Proof.", requestId: randomUUID() })
    if (!asked.ok) throw new Error("request failed")

    const approver = await createThrowawayStaff(["discounts.approve", "payments.view"])
    const preview = await previewSiblingGrant(await signedIn(approver), asked.data)
    expect(preview).toEqual({
      ok: true,
      data: { explanation: null, fullPayerTie: null, changes: [{ leadId: waiting, before: KG1, after: tenOff(KG1) }] },
    })
    expect(await basisOf(waiting)).toBe("request_needed")
  })
})

describe("sibling_full_payer_tie", () => {
  test("is true for the full payer when a sibling's fee is the same, false when it is lower, null for anyone else", async () => {
    const year = await yearWithSchedule()
    const equal = await pair(year, father(), "STD 2", "STD 2")
    const explained = await explainSiblingGroup(await signedIn(ADMISSIONS), equal.a)
    if (!explained.ok) throw new Error("no explanation")
    const payer = explained.data.fullPayerLeadId
    // The one that joined first pays full when the fees are equal.
    expect(payer).toBe(equal.a)
    expect(await getFullPayerTie(await signedIn(ACCOUNTANT), equal.a)).toEqual({ ok: true, data: true })
    expect(await getFullPayerTie(await signedIn(ACCOUNTANT), equal.b)).toEqual({ ok: true, data: null })

    const dearer = await pair(year, father(), "FORM 1", "STD 2")
    expect(await getFullPayerTie(await signedIn(ACCOUNTANT), dearer.a)).toEqual({ ok: true, data: false })

    const alone = await child(year, father(), "STD 2")
    expect(await getFullPayerTie(await signedIn(ACCOUNTANT), alone)).toEqual({ ok: true, data: null })
  })
})

describe("the father's full name on the record", () => {
  test("a close name asks first and saves nothing; a typing mistake keeps the sibling counting", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const { a, b } = await pair(year, name, "STD 2", "STD 2")
    const admissions = await signedIn(ADMISSIONS)

    const asked = await correctFatherFullName(admissions, b, { fatherFullName: close(name) })
    expect(asked).toEqual({
      ok: false,
      error: { kind: "father-name-question", fatherFullName: close(name), siblingLeadId: a, siblingFatherFullName: name },
    })
    expect((await getLeadFatherAndSchool(admissions, b)).ok && (await getLeadFatherAndSchool(admissions, b))).toMatchObject({
      data: { fatherFullName: name },
    })

    expect(await correctFatherFullName(admissions, b, { fatherFullName: close(name), answer: "typo", spelling: name })).toEqual({
      ok: true,
      data: null,
    })
    expect(await getLeadFatherAndSchool(admissions, b)).toMatchObject({
      ok: true,
      data: { fatherFullName: name, fatherFullNameSource: "typo_confirmed" },
    })
    expect(await basisOf(b)).toBe("typo_confirmed")
  })

  test("two different names stop the student counting until a Sibling request is granted", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const { b } = await pair(year, name, "STD 2", "STD 2")
    const admissions = await signedIn(ADMISSIONS)

    expect(await correctFatherFullName(admissions, b, { fatherFullName: close(name), answer: "different" })).toEqual({ ok: true, data: null })
    expect(await basisOf(b)).toBe("request_needed")
    expect(await getLeadFatherAndSchool(admissions, b)).toMatchObject({ ok: true, data: { fatherFullName: close(name), fatherFullNameSource: "edited" } })

    // A name nothing like the group's needs no question.
    const other = await pair(year, father(), "STD 2", "STD 2")
    expect(await correctFatherFullName(admissions, other.b, { fatherFullName: father() })).toEqual({ ok: true, data: null })
    expect(await basisOf(other.b)).toBe("request_needed")

    // Staff who may not edit leads change nothing.
    expect(await correctFatherFullName(await signedIn(ACCOUNTANT), b, { fatherFullName: father() })).toEqual({
      ok: false,
      error: { kind: "forbidden" },
    })
  })
})

describe("the previous school on the record", () => {
  test("saves a school or Not known yet, and refuses a region the list doesn't hold", async () => {
    const year = await yearWithSchedule()
    const lead = await child(year, father(), "STD 2")
    const admissions = await signedIn(ADMISSIONS)

    expect(await correctPreviousSchool(admissions, lead, { kind: "not-known" })).toEqual({ ok: true, data: null })
    expect(await getLeadFatherAndSchool(admissions, lead)).toMatchObject({ ok: true, data: { previousSchool: { kind: "not-known" } } })

    expect(
      await correctPreviousSchool(admissions, lead, { kind: "school", name: "Example Primary School", type: "public", region: "Tanga" }),
    ).toEqual({ ok: true, data: null })
    expect(await getLeadFatherAndSchool(admissions, lead)).toMatchObject({
      ok: true,
      data: { previousSchool: { kind: "school", name: "Example Primary School", type: "public", region: "Tanga" } },
    })

    expect(
      await correctPreviousSchool(admissions, lead, { kind: "school", name: "Example Primary School", type: "public", region: "Atlantis" }),
    ).toEqual({ ok: false, error: { kind: "invalid", field: "previous_school_region" } })
    expect(await correctPreviousSchool(await signedIn(ACCOUNTANT), lead, { kind: "not-known" })).toEqual({ ok: false, error: { kind: "forbidden" } })
  })
})
