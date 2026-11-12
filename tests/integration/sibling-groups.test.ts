import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { decideDiscount, requestDiscount } from "@/lib/services/discounts"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
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
import { setPriorSibling } from "@/lib/services/sibling-discount"

import { anonClient, asSystem, inRolledBackTransaction, lockExclusively, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

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
const WITH_SIBLING = 1_800_000

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

describe("the migration-day backfill", () => {
  test("covers every backfill case, keeps every fee, and the snapshot check raises when one fee moves", async () => {
    const year = await yearWithSchedule()
    const admissions = await signedIn(ADMISSIONS)
    const manager = await signedIn(MANAGER)

    // A Family with an Enrolled child at full, a kept 10%, a live 10%, a
    // Declined child, an Archived child and an imported Enrolled child.
    const [enrolledFull, kept, waiting, declined, archived, imported] = await family(year, 6)
    await pay(kept, WITH_SIBLING)
    await pay(enrolledFull, FULL, "full_payment")
    expect((await declineLead(manager, declined, { reason: "Other", explanation: "For the test." })).ok).toBe(true)
    await asSystem(async (sql) => {
      await sql.query("select public.set_lead_lifecycle_override('import')")
      await sql.query("update public.leads set status = 'Enrolled', enrolled_by_import = true where id = $1", [imported])
      await sql.query("select public.set_lead_lifecycle_override('close')")
      await sql.query("update public.leads set closure = 'Archived', closure_reason = 'Record created in error' where id = $1", [archived])
    })

    // Separated: a child Enrolled with a kept 10% leaves its Family, which is
    // left with one child.
    const [separatedEnrolled, separatedKept] = await family(year)
    await pay(separatedEnrolled, FULL, "full_payment")
    await pay(separatedKept, WITH_SIBLING)
    expect((await separateFromFamily(admissions, separatedKept)).ok).toBe(true)

    // A single child with the prior-sibling tick.
    const [ticked] = await family(year, 1)
    expect((await setPriorSibling(admissions, ticked, { name: "Older Brother", className: "FORM 2" })).ok).toBe(true)

    // A granted Staff child over the Sibling 10%.
    const [staffSibling, staffChild] = await family(year)
    await pay(staffSibling, FULL, "full_payment")
    const made = await requestDiscount(admissions, staffChild, "staff_child", "For the test.", randomUUID())
    if (!made.ok) throw new Error("setup failed")
    expect((await decideDiscount(manager, made.data, { decision: "grant" })).ok).toBe(true)

    // A pending match: the Admission form child of a known number.
    const knownLead = await getLead(admissions, staffSibling)
    if (!knownLead.ok) throw new Error("setup failed")
    const pending = await createLead(secretClient(), {
      guardian: { contact: { fullName: "Typed On The Form", relationship: "Mother", phone: knownLead.data.contact.phone } },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!pending.ok) throw new Error("setup failed")
    // A second child on the same unconfirmed contact, so the contact has 2 leads.
    const pendingSecond = await createLead(secretClient(), {
      guardian: { contactId: await contactOf(pending.data.leadId) },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!pendingSecond.ok) throw new Error("setup failed")

    const everyone = [
      enrolledFull, kept, waiting, declined, archived, imported, separatedEnrolled, separatedKept, ticked, staffSibling, staffChild,
      pending.data.leadId, pendingSecond.data.leadId,
    ]

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
      await sql.query("create temp table groups_snapshot_before as select * from public.fee_snapshot()")
      const results = Object.fromEntries(await Promise.all(everyone.map(async (id) => [id, await resultOf(id, sql)])))

      // As before the migration: no groups at all. Then the backfill.
      await sql.query("alter table public.sibling_group_members disable trigger refuse_delete")
      await sql.query("alter table public.sibling_groups disable trigger refuse_delete")
      // Sibling requests (#302) name groups, so they go first.
      await sql.query("alter table public.discount_requests disable trigger refuse_delete")
      await sql.query("delete from public.discount_requests where kind = 'sibling'")
      await sql.query("delete from public.sibling_group_members")
      await sql.query("delete from public.sibling_groups")
      await sql.query("select public.backfill_sibling_groups()")

      expect((await sql.query("select * from public.sibling_groups_mirror_families()")).rows).toEqual([])
      const family1 = await groupOf(enrolledFull, sql)
      expect(family1).not.toBeNull()
      for (const id of [kept, waiting, declined, archived, imported]) {
        expect(await membershipOf(id, sql)).toEqual({ group_id: family1, legacy: true, sibling_of_lead_id: null, cause: "migration" })
      }
      // A Family of one child, a separated child, a tick and a pending match of two children: no group.
      for (const id of [separatedEnrolled, separatedKept, ticked, pending.data.leadId, pendingSecond.data.leadId]) {
        expect(await membershipOf(id, sql)).toBeNull()
      }
      expect(await groupOf(staffChild, sql)).toBe(await groupOf(staffSibling, sql))
      expect(await groupOf(staffChild, sql)).not.toBeNull()

      // The rule over groups gives every lead what it gave over the Family.
      const parity = await sql.query(
        `select l.id from public.leads l
         where (select (r.result, r.source) from public.sibling_rule_result(l.id) r)
               is distinct from (select (f.result, f.source) from public.sibling_rule_result_by_family(l.id) f)`,
      )
      expect(parity.rows).toEqual([])

      // Refreshed by the rule, nothing moves: results, fees, seats.
      await sql.query("select public.refresh_sibling_result(l, 'sibling') from unnest($1::uuid[]) l", [everyone])
      for (const id of everyone) expect(await resultOf(id, sql)).toEqual(results[id])
      expect(results[waiting]).toEqual({ result: "ten", source: "auto", locked_result: null })
      expect(results[separatedKept]).toEqual({ result: "ten", source: "locked", locked_result: "ten" })
      expect(results[ticked]).toEqual({ result: "ten", source: "prior_sibling", locked_result: null })
      expect(results[pending.data.leadId]).toEqual({ result: "none", source: "auto", locked_result: null })
      await sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.groups_snapshot_before')")
      const staffFee = (await sql.query("select discount from public.lead_fee_amounts($1)", [staffChild])).rows[0]
      expect(staffFee.discount).toBe("staff_child")

      // One fee moved on purpose: the waiting child leaves its group.
      await sql.query(
        "update public.sibling_group_members set group_id = null, legacy = false, joined_at = null where lead_id = $1",
        [waiting],
      )
      await sql.query("select public.refresh_sibling_result($1, 'family')", [waiting])
      await expect(sql.query("select public.assert_fee_snapshot_unchanged('pg_temp.groups_snapshot_before')")).rejects.toThrow(
        /fee_snapshot_changed/,
      )
    })
  })
})
