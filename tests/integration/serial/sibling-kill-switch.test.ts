import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { createLead, getLead, type CreateLeadInput, type LeadClass, type NewContact } from "@/lib/services/leads"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { linkSibling } from "@/lib/services/sibling-groups"

import { asSystem, inRolledBackTransaction, signedIn } from "../../support/db"
import { claimFeeYear } from "../../support/fee-years"
import { ACCOUNTANT, ADMISSIONS } from "../../support/fixtures"

// The Sibling kill switch (#297, #301, #303), as the owner turns it in the SQL
// editor. The switch is global. Pausing takes the `sibling_grants_pause`
// advisory lock exclusive, which every Family lock in the database waits
// behind, and resuming recomputes every sibling group, other files' groups
// included. So these tests live here, in the integration-serial project,
// which runs after every other integration file has finished and one file at
// a time (vitest.config.ts): run beside other files, they deadlocked them
// (#384). Each test still runs in a transaction that is rolled back, so the
// switch is never left paused.
//
// Moved here from sibling-result.test.ts, sibling-of.test.ts and
// sibling-fee-edit.test.ts, with the helpers they need.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// Day fees: KG 1 1,100,000; STD 2 2,000,000, so 1,800,000 with the Sibling
// discount.
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
  // A leading 5 keeps it clear of the seeded numbers.
  return {
    fullName: `Kill Switch Parent ${randomUUID().slice(0, 6)}`,
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

// A confirmed front-desk Family of `size` Passed STD 2 children in `year`, on
// one contact.
async function family(year: number, size = 2): Promise<string[]> {
  const admissions = await signedIn(ADMISSIONS)
  const ids: string[] = []
  let guardian: CreateLeadInput["guardian"] = { contact: parent() }
  for (let i = 0; i < size; i++) {
    const created = await createLead(admissions, {
      guardian,
      student: { fullName: `Result ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
    ids.push(created.data.leadId)
    if (i === 0) guardian = { contactId: await contactOf(created.data.leadId) }
  }
  for (const id of ids) await pass(id, year)
  return ids
}

// A Passed child in `year` on a new contact, named for `fatherName`.
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

// Two children with one father, on two contacts, linked: registered together.
async function together(year: number): Promise<{ dear: string; cheap: string; group: string }> {
  const name = father()
  const dear = await child(year, name, "STD 2")
  const cheap = await child(year, name, "KG 1")
  const linked = await linkSibling(await signedIn(ADMISSIONS), { leadId: cheap, siblingOfLeadId: dear })
  if (!linked.ok || linked.data.kind !== "linked") throw new Error(`link failed: ${JSON.stringify(linked)}`)
  expect(linked.data.basis).toBe("matched")
  return { dear, cheap, group: linked.data.groupId }
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

type Stored = { result: string; source: string; locked_result: string | null }

// The stored result, none/auto for a lead with no row.
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

async function discountOf(sql: Client, leadId: string) {
  return (
    await sql.query<{ discount: string | null; school_fee: number | null }>("select discount, school_fee from public.lead_fee_amounts($1)", [
      leadId,
    ])
  ).rows[0]
}

// A statement as `staff` signed in, on a direct connection inside `sql`'s
// transaction. A savepoint keeps the transaction usable when it fails.
async function asStaff(sql: Client, staffId: string, query: string, params: unknown[] = []) {
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
  await sql.query("savepoint as_staff")
  try {
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
    await sql.query("set local role authenticated")
    const result = (await sql.query(query, params)).rows
    await sql.query("reset role")
    await sql.query("release savepoint as_staff")
    return result
  } catch (error) {
    await sql.query("rollback to savepoint as_staff")
    throw error
  }
}

describe("the stored Sibling result (#297)", () => {
  test("stops new 10% grants for children not yet Enrolled, leaves Enrolled results alone, and resuming gives them", async () => {
    const year = await yearWithSchedule()
    const [held, holder] = await family(year)
    // A Family that already holds a locked 10% before the pause.
    await pay(holder, WITH_SIBLING)
    await pay(held, FULL, "full_payment")
    expect(await resultOf(holder)).toMatchObject({ result: "ten", source: "locked" })

    const [first, second] = await family(year)
    // Enough to enrol second at the discounted fee, not at the full fee.
    await pay(second, WITH_SIBLING, "first_instalment")
    expect(await statusOf(second)).toBe("Interviewed")

    // The switch is global, so the whole run stays in one transaction that
    // is rolled back, as the owner in the SQL editor.
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_sibling_grants_paused(true)")

      await sql.query(
        `insert into public.school_fee_payments (lead_id, payment_type, amount, paid_on, recorded_by, request_id)
         values ($1, 'full_payment', $2, $3, $4, gen_random_uuid())`,
        [first, FULL, today, ACCOUNTANT.id],
      )
      await sql.query("select public.recompute_lead_fee($1, 'payment')", [first])
      const status = async (id: string) => (await sql.query<{ status: string }>("select status::text from public.leads where id = $1", [id])).rows[0].status
      expect(await status(first)).toBe("Enrolled")
      // No new 10% while paused: second stays at the full fee, not Enrolled.
      expect(await resultOf(second, sql)).toEqual({ result: "none", source: "auto", locked_result: null })
      expect(await discountOf(sql, second)).toEqual({ discount: null, school_fee: FULL })
      expect(await status(second)).toBe("Interviewed")
      // The Enrolled 10% from before is untouched, and so is the full lock.
      expect(await resultOf(holder, sql)).toMatchObject({ result: "ten", source: "locked" })
      expect(await resultOf(held, sql)).toMatchObject({ result: "full", source: "locked" })

      // The same answer again changes nothing.
      await sql.query("select public.set_sibling_grants_paused(true)")
      const changes = await sql.query("select 1 from public.audit_log where table_name = 'sibling_rule_settings'")

      await sql.query("select public.set_sibling_grants_paused(false)")
      expect(await resultOf(second, sql)).toMatchObject({ result: "ten", source: "locked" })
      expect(await discountOf(sql, second)).toEqual({ discount: "sibling", school_fee: WITH_SIBLING })
      expect(await status(second)).toBe("Enrolled")
      const after = await sql.query("select 1 from public.audit_log where table_name = 'sibling_rule_settings'")
      expect(after.rowCount).toBe((changes.rowCount ?? 0) + 1)
    })
  })

  test("resuming waits for every transaction holding a Family lock, so it sees what they enrolled", async () => {
    const [child] = await family(await yearWithSchedule(), 1)
    const contactId = await contactOf(child)

    // Stands in for a payment that is enrolling a child while grants are paused.
    await inRolledBackTransaction(async (holder) => {
      await holder.query("select public.lock_families(array[$1::uuid])", [contactId])

      let resumed = false
      const resuming = inRolledBackTransaction(async (owner) => {
        await owner.query("select public.set_audit_actor('system')")
        await owner.query("select public.set_sibling_grants_paused(false)")
        resumed = true
      })

      const waiting = async () =>
        (
          await holder.query<{ n: number }>(
            `select count(*)::int as n from pg_locks
             where locktype = 'advisory' and not granted and objsubid = 1 and objid::int = hashtext('sibling_grants_pause')`,
          )
        ).rows[0].n
      for (let tries = 0; (await waiting()) === 0; tries++) {
        if (tries > 100) throw new Error("resuming never waited on the pause lock")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(resumed).toBe(false)

      await holder.query("rollback")
      await holder.query("begin")
      await resuming
      expect(resumed).toBe(true)
    })
  })

  test("is refused without an actor and turned only by the owner", async () => {
    await inRolledBackTransaction(async (sql) => {
      await expect(sql.query("select public.set_sibling_grants_paused(true)")).rejects.toThrow(/not_permitted/)
    })
    const { error } = await (await signedIn(ACCOUNTANT)).rpc("set_sibling_grants_paused", { paused: true })
    expect(error).not.toBeNull()
  })
})

describe('"Sibling of" and the Sibling fee rule (#301)', () => {
  test("the kill switch holds back the 10% at once, and resuming gives it", async () => {
    const { dear, cheap, group } = await together(await yearWithSchedule())

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

describe("the manual Sibling fee edit (#303)", () => {
  test("the kill switch never changes a manual value; a manual 10% saves while paused; Back to automatic gives no new 10%", async () => {
    const { cheap } = await together(await yearWithSchedule())
    expect(await resultOf(cheap)).toMatchObject({ result: "ten", source: "auto" })

    // The switch is global, so the run stays in one transaction that is
    // rolled back.
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_sibling_grants_paused(true)")

      await asStaff(sql, ACCOUNTANT.id, "select public.edit_sibling_fee($1, 'full', 'data_entry_correction', null, $2)", [cheap, randomUUID()])
      expect(await resultOf(cheap, sql)).toMatchObject({ result: "full", source: "manual" })

      await asStaff(sql, ACCOUNTANT.id, "select public.edit_sibling_fee($1, 'automatic', 'data_entry_correction', null, $2)", [
        cheap,
        randomUUID(),
      ])
      expect(await resultOf(cheap, sql)).toMatchObject({ result: "none", source: "auto" })

      await asStaff(sql, ACCOUNTANT.id, "select public.edit_sibling_fee($1, 'ten', 'data_entry_correction', null, $2)", [cheap, randomUUID()])
      expect(await resultOf(cheap, sql)).toMatchObject({ result: "ten", source: "manual" })

      await sql.query("select public.set_sibling_grants_paused(false)")
      expect(await resultOf(cheap, sql)).toMatchObject({ result: "ten", source: "manual" })
    })
  })
})
