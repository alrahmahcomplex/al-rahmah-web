import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { getLeadFee } from "@/lib/services/lead-fees"
import {
  confirmFamilyMatch,
  createLead,
  getLead,
  rejectFamilyMatch,
  separateFromFamily,
  type CreateLeadInput,
  type NewContact,
} from "@/lib/services/leads"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS } from "../support/fixtures"

// Sibling groups (#300): every confirmed Family with 2 or more leads is one
// legacy group, and today's Sibling rule reads the group. Through the leads,
// fees and payments modules against local Supabase, plus SQL as the owner for
// the locks and the migration-day backfill. Each test makes Families of its
// own in a year it claims.

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

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  // A leading 6 keeps it clear of the seeded numbers and the other sibling suites.
  return {
    fullName: `Group Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

function student() {
  return { fullName: `Group ${randomUUID().slice(0, 8)}`, className: "STD 2" as const, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" as const }
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

// A confirmed front-desk Family of `size` Passed children in `year`.
async function family(year: number, size = 2): Promise<string[]> {
  const admissions = await signedIn(ADMISSIONS)
  const ids: string[] = []
  let guardian: CreateLeadInput["guardian"] = { contact: parent() }
  for (let i = 0; i < size; i++) {
    const created = await createLead(admissions, { guardian, student: student(), start: { kind: "walk-in", visitDate: yesterday } })
    if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
    ids.push(created.data.leadId)
    if (i === 0) guardian = { contactId: await contactOf(created.data.leadId) }
  }
  for (const id of ids) await pass(id, year)
  return ids
}

async function pay(leadId: string, amount: number, type: PaymentInput["type"] = "initial_deposit") {
  const paid = await recordPayment(await signedIn(ACCOUNTANT), leadId, { type, amount, paidOn: today }, randomUUID())
  if (!paid.ok) throw new Error(`payment failed: ${paid.error}`)
  return paid.data.paymentId
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

type Stored = { result: string; source: string; locked_result: string | null }

async function resultOf(leadId: string, sql?: Client): Promise<Stored> {
  const read = async (client: Client) =>
    (
      await client.query<Stored>(
        `select coalesce(r.result::text, 'none') as result, coalesce(r.source::text, 'auto') as source, r.locked_result::text as locked_result
         from (select 1) one left join public.lead_sibling_results r on r.lead_id = $1`,
        [leadId],
      )
    ).rows[0]
  return sql ? read(sql) : inRolledBackTransaction(read)
}

type Membership = { group_id: string | null; legacy: boolean; sibling_of_lead_id: string | null; cause: string } | null

async function membershipOf(leadId: string, sql?: Client): Promise<Membership> {
  const read = async (client: Client) =>
    (
      await client.query<NonNullable<Membership>>(
        "select group_id, legacy, sibling_of_lead_id, cause from public.sibling_group_members where lead_id = $1",
        [leadId],
      )
    ).rows[0] ?? null
  return sql ? read(sql) : inRolledBackTransaction(read)
}

async function groupOf(leadId: string, sql?: Client): Promise<string | null> {
  return (await membershipOf(leadId, sql))?.group_id ?? null
}

async function mirrorMismatches(sql: Client, leadIds: string[]) {
  return (await sql.query("select lead_id from public.sibling_groups_mirror_families() where lead_id = any($1)", [leadIds])).rows
}

// Waits until some other session waits on the advisory lock `classid, objid`.
async function untilWaitingOn(sql: Client, classKey: string, objKey: string, what: string) {
  for (let tries = 0; ; tries++) {
    const { rows } = await sql.query<{ n: number }>(
      `select count(*)::int as n from pg_locks
       where locktype = 'advisory' and not granted and classid::int = hashtext($1) and objid::int = hashtext($2)`,
      [classKey, objKey],
    )
    if (rows[0].n > 0) return
    if (tries > 100) throw new Error(`${what} never waited`)
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

describe("groups follow the confirmed Family", () => {
  test("the second child on a contact makes a legacy group, a third joins it, and the history shows each joining", async () => {
    const [first, second, third] = await family(await yearWithSchedule(), 3)
    const group = await groupOf(first)
    expect(group).not.toBeNull()
    for (const id of [first, second, third]) {
      expect(await membershipOf(id)).toEqual({ group_id: group, legacy: true, sibling_of_lead_id: null, cause: "lead_created" })
    }

    const history = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query<{ table_name: string; action: string }>(
          "select table_name, action from public.audit_log where lead_id = $1 and table_name = 'sibling_group_members'",
          [third],
        )
      ).rows,
    )
    expect(history).toEqual([{ table_name: "sibling_group_members", action: "insert" }])
    await inRolledBackTransaction(async (sql) => expect(await mirrorMismatches(sql, [first, second, third])).toEqual([]))
  })

  test("a child joining a Family with an Enrolled child holds the 10% from the group", async () => {
    const year = await yearWithSchedule()
    const [enrolled] = await family(year, 1)
    await pay(enrolled, FULL, "full_payment")
    expect(await groupOf(enrolled)).toBeNull()

    const later = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contactId: await contactOf(enrolled) },
      student: student(),
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!later.ok) throw new Error("setup failed")
    expect(await groupOf(later.data.leadId)).toBe(await groupOf(enrolled))
    expect(await resultOf(later.data.leadId)).toEqual({ result: "ten", source: "auto", locked_result: null })
  })

  test("the rule reads the group, not the contact", async () => {
    const year = await yearWithSchedule()
    const [enrolled, waiting] = await family(year)
    await pay(enrolled, FULL, "full_payment")
    expect(await resultOf(waiting)).toEqual({ result: "ten", source: "auto", locked_result: null })

    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // Out of the group, still on the same contact: no 10%.
      await sql.query(
        "update public.sibling_group_members set group_id = null, legacy = false, joined_at = null, cause = 'family' where lead_id = $1",
        [waiting],
      )
      await sql.query("select public.refresh_sibling_result($1, 'family')", [waiting])
      expect(await resultOf(waiting, sql)).toEqual({ result: "none", source: "auto", locked_result: null })
    })
  })

  test("settling a pending match: confirming joins the known Family's group and runs the rule", async () => {
    const year = await yearWithSchedule()
    const [known] = await family(year, 1)
    await pay(known, FULL, "full_payment")
    const phone = (await getLead(await signedIn(ADMISSIONS), known)) as { ok: true; data: { contact: { phone: string } } }

    const form = await createLead(secretClient(), {
      guardian: { contact: { fullName: "Typed On The Form", relationship: "Mother", phone: phone.data.contact.phone } },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!form.ok) throw new Error("setup failed")
    expect(await membershipOf(form.data.leadId)).toBeNull()
    expect(await resultOf(form.data.leadId)).toEqual({ result: "none", source: "auto", locked_result: null })

    expect(await confirmFamilyMatch(await signedIn(ADMISSIONS), form.data.leadId)).toEqual({ ok: true, data: null })
    const group = await groupOf(known)
    expect(group).not.toBeNull()
    expect(await membershipOf(form.data.leadId)).toEqual({ group_id: group, legacy: true, sibling_of_lead_id: null, cause: "family" })
    expect(await resultOf(form.data.leadId)).toEqual({ result: "ten", source: "auto", locked_result: null })
    await inRolledBackTransaction(async (sql) => expect(await mirrorMismatches(sql, [known, form.data.leadId])).toEqual([]))
  })

  test("confirming two form children into a Family: both join its group once, with one history entry each", async () => {
    const [known] = await family(await yearWithSchedule(), 1)
    const lead = await getLead(await signedIn(ADMISSIONS), known)
    if (!lead.ok) throw new Error("setup failed")
    const formClient = secretClient()
    const first = await createLead(formClient, {
      guardian: { contact: { fullName: "Typed On The Form", relationship: "Mother", phone: lead.data.contact.phone } },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!first.ok) throw new Error("setup failed")
    const second = await createLead(formClient, {
      guardian: { contactId: await contactOf(first.data.leadId) },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!second.ok) throw new Error("setup failed")

    expect(await confirmFamilyMatch(await signedIn(ADMISSIONS), first.data.leadId)).toEqual({ ok: true, data: null })
    const group = await groupOf(known)
    expect(group).not.toBeNull()
    for (const id of [first.data.leadId, second.data.leadId]) {
      expect(await membershipOf(id)).toEqual({ group_id: group, legacy: true, sibling_of_lead_id: null, cause: "family" })
      const entries = await inRolledBackTransaction(async (sql) =>
        (await sql.query("select action from public.audit_log where lead_id = $1 and table_name = 'sibling_group_members'", [id])).rows,
      )
      expect(entries).toEqual([{ action: "insert" }])
    }
    await inRolledBackTransaction(async (sql) =>
      expect(await mirrorMismatches(sql, [known, first.data.leadId, second.data.leadId])).toEqual([]),
    )
  })

  test("settling a pending match: rejecting makes the contact's children a group of their own", async () => {
    const [known] = await family(await yearWithSchedule(), 1)
    const lead = await getLead(await signedIn(ADMISSIONS), known)
    if (!lead.ok) throw new Error("setup failed")
    const formClient = secretClient()
    const first = await createLead(formClient, {
      guardian: { contact: { fullName: "Typed On The Form", relationship: "Mother", phone: lead.data.contact.phone } },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!first.ok) throw new Error("setup failed")
    const second = await createLead(formClient, {
      guardian: { contactId: await contactOf(first.data.leadId) },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!second.ok) throw new Error("setup failed")
    expect(await membershipOf(first.data.leadId)).toBeNull()
    expect(await membershipOf(second.data.leadId)).toBeNull()

    expect(await rejectFamilyMatch(await signedIn(ADMISSIONS), first.data.leadId)).toEqual({ ok: true, data: null })
    const group = await groupOf(first.data.leadId)
    expect(group).not.toBeNull()
    expect(group).not.toBe(await groupOf(known))
    expect(await groupOf(second.data.leadId)).toBe(group)
    await inRolledBackTransaction(async (sql) =>
      expect(await mirrorMismatches(sql, [known, first.data.leadId, second.data.leadId])).toEqual([]),
    )
  })

  test("separating a child takes it out of its legacy group, with its 10%, and the rest keep theirs", async () => {
    const year = await yearWithSchedule()
    const [enrolled, staying, leaving] = await family(year, 3)
    await pay(enrolled, FULL, "full_payment")
    const group = await groupOf(enrolled)
    expect(await resultOf(leaving)).toEqual({ result: "ten", source: "auto", locked_result: null })

    expect(await separateFromFamily(await signedIn(ADMISSIONS), leaving)).toEqual({ ok: true, data: null })
    expect(await membershipOf(leaving)).toEqual({ group_id: null, legacy: false, sibling_of_lead_id: null, cause: "family" })
    expect(await resultOf(leaving)).toEqual({ result: "none", source: "auto", locked_result: null })
    expect(await feeOf(leaving)).toMatchObject({ schoolFee: FULL, discount: null })
    expect(await groupOf(staying)).toBe(group)
    expect(await resultOf(staying)).toEqual({ result: "ten", source: "auto", locked_result: null })
    await inRolledBackTransaction(async (sql) => expect(await mirrorMismatches(sql, [enrolled, staying, leaving])).toEqual([]))
  })
})

describe("the group lock", () => {
  test("a payment takes the Family lock, then waits on the group lock before any row", async () => {
    const year = await yearWithSchedule()
    const [first, second] = await family(year)
    const group = await groupOf(first)
    if (!group) throw new Error("setup failed")

    await inRolledBackTransaction(async (holder) => {
      await holder.query("select pg_advisory_xact_lock(hashtext('sibling_group'), hashtext($1))", [group])
      const paying = pay(second, FULL, "full_payment")
      await untilWaitingOn(holder, "sibling_group", group, "the payment")

      // It holds the Family lock while it waits, and no row of the lead.
      const contact = await contactOf(second)
      const { rows } = await holder.query<{ n: number }>(
        `select count(*)::int as n from pg_locks
         where locktype = 'advisory' and granted and pid <> pg_backend_pid()
           and classid::int = hashtext('lead_family') and objid::int = hashtext($1)`,
        [contact],
      )
      expect(rows[0].n).toBe(1)
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
    expect(await resultOf(second)).toEqual({ result: "full", source: "locked", locked_result: "full" })
    expect(await resultOf(first)).toEqual({ result: "ten", source: "auto", locked_result: null })
  })

  test("two payments enrolling two siblings at once: one locks full and the other the 10%, never both", async () => {
    const year = await yearWithSchedule()
    const [first, second] = await family(year)
    // The full fee: enough to enrol either child, with or without the 10%.
    await Promise.all([pay(first, FULL, "full_payment"), pay(second, FULL, "full_payment")])

    expect([await statusOf(first), await statusOf(second)]).toEqual(["Enrolled", "Enrolled"])
    const locks = [(await resultOf(first)).locked_result, (await resultOf(second)).locked_result].sort()
    expect(locks).toEqual(["full", "ten"])
  })
})

describe("the tables", () => {
  test("are readable with leads.view, written by nobody through the API, and never deleted", async () => {
    const [child] = await family(await yearWithSchedule())
    const group = await groupOf(child)

    const staff = await signedIn(ADMISSIONS)
    expect((await staff.from("sibling_group_members").select("lead_id, group_id, legacy").eq("lead_id", child)).data).toEqual([
      { lead_id: child, group_id: group, legacy: true },
    ])
    expect((await staff.from("sibling_groups").select("id, full_payer_lead_id").eq("id", group!)).data).toEqual([
      { id: group, full_payer_lead_id: null },
    ])
    expect((await anonClient().from("sibling_group_members").select("id").eq("lead_id", child)).data ?? []).toEqual([])
    expect((await anonClient().from("sibling_groups").select("id").eq("id", group!)).data ?? []).toEqual([])
    expect((await staff.from("sibling_group_members").update({ legacy: false }).eq("lead_id", child)).error).not.toBeNull()
    expect((await staff.from("sibling_groups").insert({ cause: "family" })).error).not.toBeNull()
    await expect(asSystem((sql) => sql.query("delete from public.sibling_group_members where lead_id = $1", [child]))).rejects.toThrow(
      /delete_refused/,
    )
    await expect(asSystem((sql) => sql.query("delete from public.sibling_groups where id = $1", [group]))).rejects.toThrow(/delete_refused/)
  })
})

