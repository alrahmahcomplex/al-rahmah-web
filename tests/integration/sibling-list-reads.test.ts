import { randomInt, randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, searchLeads, type LeadClass, type NewContact, type SiblingFollowUp } from "@/lib/services/leads"
import { recordPayment } from "@/lib/services/school-fee-payments"
import { getSiblingListTags } from "@/lib/services/sibling-counts"
import { editSiblingFee, linkSibling, type LinkSiblingInput } from "@/lib/services/sibling-groups"
import { decideSiblingRequest, dismissSiblingFeeEdit, requestSiblingDiscount } from "@/lib/services/sibling-requests"

import { asSystem, createThrowawayStaff, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SEEDED_AGENT } from "../support/fixtures"

// The two reads behind the Sibling screens on Applicants and Reports (#311):
// sibling_list_tags, the Sibling discount column, and
// leads_for_sibling_follow_up, the list a Reports count opens. Each test
// makes its own families in a year it claims. The follow-up lists span every
// year and other files run beside this one, so the tests look only for
// their own leads in them.

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

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  return {
    fullName: `Sibling List Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

function father(): string {
  const word = () => randomUUID().replace(/[^a-f]/g, "").slice(0, 6).padEnd(6, "a")
  return `L${word()} T${word()}`
}

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

async function payInFull(leadId: string) {
  const fee = await getLeadFee(await signedIn(ADMISSIONS), leadId)
  if (!fee.ok || fee.data.kind !== "fee") throw new Error(`no fee: ${JSON.stringify(fee)}`)
  const paid = await recordPayment(await signedIn(ACCOUNTANT), leadId, { type: "full_payment", amount: fee.data.schoolFee, paidOn: today }, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
}

// A student Enrolled at full, then granted into another family's group:
// "Granted: fee edit needed".
async function grantedAfterEnrolment(year: number, into: string) {
  const id = await child(year, father(), "STD 2")
  await payInFull(id)
  expect(await link({ leadId: id, siblingOfLeadId: into })).toMatchObject({ basis: "request_needed" })
  const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), { leadId: id, note: "Both birth certificates.", requestId: randomUUID() })
  if (!asked.ok) throw new Error(`request failed: ${JSON.stringify(asked.error)}`)
  const granted = await decideSiblingRequest(await signedIn(MANAGER), asked.data, { decision: "grant" })
  if (!granted.ok) throw new Error(`grant failed: ${granted.error}`)
  return id
}

// Which of `mine` the follow-up list holds.
async function inList(by: SupabaseClient, kind: SiblingFollowUp, mine: string[]) {
  const { data, error } = await by.rpc("leads_for_sibling_follow_up", { kind }).select("id").in("id", mine)
  if (error) return { error: error.message }
  return { ids: (data as { id: string }[]).map((r) => r.id).sort() }
}

describe("sibling_list_tags", () => {
  test("gives each grouped lead its own tag, explains a group once, and leaves out a lead in no group", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const dear = await child(year, name, "FORM 1")
    const cheap = await child(year, name, "KG 1")
    await link({ leadId: cheap, siblingOfLeadId: dear })
    const waiting = await child(year, father(), "STD 2")
    await link({ leadId: waiting, siblingOfLeadId: dear })
    const asked = await requestSiblingDiscount(await signedIn(ADMISSIONS), { leadId: waiting, note: "Proof.", requestId: randomUUID() })
    if (!asked.ok) throw new Error("request failed")
    const alone = await child(year, father(), "STD 2")

    const tags = await getSiblingListTags(await signedIn(ADMISSIONS), [dear, cheap, waiting, alone])
    expect(tags.ok).toBe(true)
    if (!tags.ok) return
    expect([...tags.data.keys()].sort()).toEqual([dear, cheap, waiting].sort())
    expect(tags.data.get(dear)).toMatchObject({ reason: "full_payer", result: "full", grantsPaused: false })
    expect(tags.data.get(cheap)).toMatchObject({ reason: "full_payer_sibling", result: "ten" })
    expect(tags.data.get(waiting)).toMatchObject({ reason: "request_pending", pendingRequest: { requestId: asked.data } })
  })

  test("is refused without leads.view and for more than 100 leads", async () => {
    const agent = await signedIn(SEEDED_AGENT)
    expect(await getSiblingListTags(agent, [randomUUID()])).toEqual({ ok: false, error: "forbidden" })
    const many = Array.from({ length: 101 }, () => randomUUID())
    expect(await getSiblingListTags(await signedIn(ADMISSIONS), many)).toEqual({ ok: false, error: "unavailable" })
    expect(await getSiblingListTags(await signedIn(ADMISSIONS), [])).toEqual({ ok: true, data: new Map() })
  })
})

describe("leads_for_sibling_follow_up", () => {
  test("lists exactly the leads its count names: fee edit needed until applied or left as it is", async () => {
    const year = await yearWithSchedule()
    const anchor = await child(year, father(), "FORM 1")
    const needed = await grantedAfterEnrolment(year, anchor)
    const applied = await grantedAfterEnrolment(year, anchor)
    const kept = await grantedAfterEnrolment(year, anchor)
    const mine = [needed, applied, kept]
    const accountant = await signedIn(ACCOUNTANT)
    expect(await inList(accountant, "fee_edit_needed", mine)).toEqual({ ids: [...mine].sort() })

    const edit = await editSiblingFee(accountant, { leadId: applied, value: "ten", reason: "sibling_proof_after_enrolment" }, randomUUID())
    expect(edit.ok).toBe(true)
    expect((await dismissSiblingFeeEdit(accountant, kept, "The invoice is already sent.")).ok).toBe(true)
    expect(await inList(accountant, "fee_edit_needed", mine)).toEqual({ ids: [needed] })

    // The Applicants list pages the same rows, newest first, whatever the
    // other filters say.
    const page = await searchLeads(accountant, { siblingFollowUp: "fee_edit_needed", status: "Applied", closure: "Archived", page: 1 })
    expect(page.ok).toBe(true)
    if (!page.ok) return
    const listed = page.data.leads.map((l) => l.id)
    expect(listed).toContain(needed)
    expect(listed).not.toContain(applied)
    expect(listed).not.toContain(kept)
  })

  test("Enrolled at 10% with nobody at full, and a 10% kept when leaving the old family rule", async () => {
    const year = await yearWithSchedule()
    const name = father()
    const dear = await child(year, name, "FORM 1")
    const cheap = await child(year, name, "KG 1")
    await link({ leadId: cheap, siblingOfLeadId: dear })
    // The cheaper child enrols with the 10%; the full payer never has.
    await payInFull(cheap)
    const kept = await child(year, father(), "STD 2")
    // A 10% kept when leaving legacy, planted as #301 leaves it.
    await asSystem(async (sql) => {
      await sql.query("set local session_replication_role = replica")
      await sql.query(
        "insert into public.lead_sibling_results (lead_id, result, source, cause) values ($1, 'ten', 'legacy', 'left_legacy') on conflict (lead_id) do update set result = 'ten', source = 'legacy', cause = 'left_legacy'",
        [kept],
      )
    })
    const accountant = await signedIn(ACCOUNTANT)
    const mine = [dear, cheap, kept]
    expect(await inList(accountant, "no_full", mine)).toEqual({ ids: [cheap] })
    expect(await inList(accountant, "kept_ten", mine)).toEqual({ ids: [kept] })
  })

  test("previous school not known yet and missing, for staff who may view leads", async () => {
    const year = await yearWithSchedule()
    const unknown = await child(year, father(), "STD 2")
    const missing = await child(year, father(), "STD 3")
    const young = await child(year, father(), "KG 1")
    await asSystem((sql) =>
      sql.query(
        "update public.leads set previous_school_not_known = (id = $1), previous_school_name = null, previous_school_type = null, previous_school_region = null where id = any ($2)",
        [unknown, [unknown, missing, young]],
      ),
    )
    const admissions = await signedIn(ADMISSIONS)
    const mine = [unknown, missing, young]
    expect(await inList(admissions, "not_known", mine)).toEqual({ ids: [unknown] })
    expect(await inList(admissions, "missing", mine)).toEqual({ ids: [missing] })
  })

  test("refuses the fee lists without payments.view, an unknown kind, and the agent", async () => {
    const reader = await signedIn(await createThrowawayStaff(["leads.view"]))
    for (const kind of ["kept_ten", "no_full", "fee_edit_needed"] as const) {
      expect(await inList(reader, kind, [randomUUID()])).toEqual({ error: "not_permitted" })
    }
    expect(await inList(reader, "not_known", [randomUUID()])).toEqual({ ids: [] })
    expect(await inList(reader, "anything" as SiblingFollowUp, [randomUUID()])).toEqual({ error: "invalid" })
    expect(await inList(await signedIn(SEEDED_AGENT), "not_known", [randomUUID()])).toEqual({ error: "not_permitted" })
    const viewer = await createThrowawayStaff(["leads.view", "payments.view"])
    expect(await inList(await signedIn(viewer), "kept_ten", [randomUUID()])).toEqual({ ids: [] })
  })
})
