import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"
import { recordInterviewResult, registerForInterview } from "@/lib/services/interviews"
import { declineLead } from "@/lib/services/lead-closure"
import { getLeadFee } from "@/lib/services/lead-fees"
import { createLead, getLead, recordVisit, updateLeadDetails, type CreateLeadInput, type LeadClass, type NewContact } from "@/lib/services/leads"
import { adjustPayment } from "@/lib/services/payment-adjustments"
import { recordPayment, type PaymentInput } from "@/lib/services/school-fee-payments"
import { setPriorSibling } from "@/lib/services/sibling-groups"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { claimFeeYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The stored Sibling result (#297): one result and source per lead, written
// by today's rule, locked when the lead becomes Enrolled. Through the fees
// and leads modules against local Supabase, plus SQL as the owner for the
// kill switch and the migration-day snapshot check, which only the owner
// reaches. Each test makes Families of its own in a year it claims.

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
const SIBLING = { kind: "sibling", percent: 10 }

async function yearWithSchedule(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), claim.year, AMOUNTS)
  if (!saved.ok) throw new Error(`schedule failed: ${JSON.stringify(saved.error)}`)
  return claim.year
}

function parent(): NewContact {
  // A leading 5 keeps it clear of the seeded numbers and of the sibling
  // discount tests' 04 numbers.
  return {
    fullName: `Result Parent ${randomUUID().slice(0, 6)}`,
    relationship: "Mother",
    phone: `05${String(randomInt(0, 100_000_000)).padStart(8, "0")}`,
  }
}

function student(className: LeadClass = "STD 2") {
  return { fullName: `Result ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding: "Day" as const }
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
    const created = await createLead(admissions, {
      guardian,
      student: student(),
      start: { kind: "walk-in", visitDate: yesterday },
    })
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
  return (await sql.query<{ discount: string | null; school_fee: number | null }>(
    "select discount, school_fee from public.lead_fee_amounts($1)",
    [leadId],
  )).rows[0]
}

describe("the lock at enrolment", () => {
  test("a child Enrolled at full keeps its full result when a payment correction takes it out of Enrolled, while a sibling is Enrolled", async () => {
    const [first, second] = await family(await yearWithSchedule())
    const secondPayment = await pay(second, WITH_SIBLING)
    const firstPayment = await pay(first, FULL, "full_payment")
    expect([await statusOf(first), await statusOf(second)]).toEqual(["Enrolled", "Enrolled"])
    expect(await resultOf(first)).toEqual({ result: "full", source: "locked", locked_result: "full" })
    expect(await resultOf(second)).toEqual({ result: "ten", source: "locked", locked_result: "ten" })

    const accountant = await signedIn(ACCOUNTANT)
    const corrected = await adjustPayment(
      accountant,
      firstPayment,
      { reason: "Data-entry correction", void: false, type: "full_payment", amount: 1_900_000, paidOn: today, note: null },
      randomUUID(),
    )
    expect(corrected.ok).toBe(true)
    expect(await statusOf(first)).toBe("Interviewed")
    expect(await resultOf(first)).toEqual({ result: "full", source: "locked", locked_result: "full" })
    expect(await feeOf(first)).toMatchObject({ schoolFee: FULL, discount: null })
    // The sibling is untouched.
    expect(await statusOf(second)).toBe("Enrolled")
    expect(await feeOf(second)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })

    // Corrected back: Enrolled again, at full, with the same lock.
    const back = await adjustPayment(
      accountant,
      firstPayment,
      { reason: "Data-entry correction", void: false, type: "full_payment", amount: FULL, paidOn: today, note: null },
      randomUUID(),
    )
    expect(back.ok).toBe(true)
    expect(await statusOf(first)).toBe("Enrolled")
    expect(await resultOf(first)).toEqual({ result: "full", source: "locked", locked_result: "full" })

    // A locked 10% survives a correction too, as the kept discount did.
    const voided = await adjustPayment(accountant, secondPayment, { reason: "Duplicate entry", void: true, note: null }, randomUUID())
    expect(voided.ok).toBe(true)
    expect(await statusOf(second)).toBe("Interviewed")
    expect(await resultOf(second)).toEqual({ result: "ten", source: "locked", locked_result: "ten" })
    expect(await feeOf(second)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })
  })

  test("the tick still gives the 10% over a full lock, and clearing it goes back to the lock", async () => {
    const [child] = await family(await yearWithSchedule(), 1)
    await pay(child, FULL, "full_payment")
    expect(await resultOf(child)).toEqual({ result: "full", source: "locked", locked_result: "full" })

    const admissions = await signedIn(ADMISSIONS)
    expect((await setPriorSibling(admissions, child, { name: "Older Sister", className: "STD 7" })).ok).toBe(true)
    expect(await resultOf(child)).toEqual({ result: "ten", source: "prior_sibling", locked_result: "full" })
    expect(await feeOf(child)).toMatchObject({ schoolFee: WITH_SIBLING, discount: SIBLING })

    expect((await setPriorSibling(admissions, child, null)).ok).toBe(true)
    expect(await resultOf(child)).toEqual({ result: "full", source: "locked", locked_result: "full" })
    expect(await feeOf(child)).toMatchObject({ schoolFee: FULL, discount: null })
  })
})

describe("other ways into Enrolled, and lock order", () => {
  test("the student import's Enrolled locks with the answer an Enrolled lead had, and keeps it out of Enrolled", async () => {
    const [first, imported] = await family(await yearWithSchedule())
    await pay(first, FULL, "full_payment")
    expect(await resultOf(imported)).toEqual({ result: "ten", source: "auto", locked_result: null })

    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // As confirm_student_import sets Enrolled, with no payment.
      await sql.query("select public.set_lead_lifecycle_override('import')")
      await sql.query("update public.leads set status = 'Enrolled', enrolled_by_import = true where id = $1", [imported])
      // An Enrolled lead's live answer was the kept discount or the tick: full.
      expect(await resultOf(imported, sql)).toEqual({ result: "full", source: "locked", locked_result: "full" })
      expect(await discountOf(sql, imported)).toEqual({ discount: null, school_fee: FULL })

      // Taken out of Enrolled while its sibling is Enrolled: the lock holds.
      await sql.query("select public.set_lead_lifecycle_override('payment_recompute')")
      await sql.query("update public.leads set status = 'Interviewed' where id = $1", [imported])
      await sql.query("select public.recompute_lead_fee($1, 'payment_adjustment')", [imported])
      expect(await resultOf(imported, sql)).toEqual({ result: "full", source: "locked", locked_result: "full" })
      expect(await discountOf(sql, imported)).toEqual({ discount: null, school_fee: FULL })
    })
  })

  test("a child added to a known Family takes the Family lock before the phone locks, as confirming a match does", async () => {
    const [known] = await family(await yearWithSchedule(), 1)
    const contactId = await contactOf(known)
    const contact = await getLead(await signedIn(ADMISSIONS), known)
    if (!contact.ok) throw new Error("setup failed")
    const phone = contact.data.contact.phone

    // Holds the Family lock, as confirm_family_match does before its phone locks.
    await inRolledBackTransaction(async (holder) => {
      await holder.query("select public.lock_families(array[$1::uuid])", [contactId])
      const creating = createLead(await signedIn(ADMISSIONS), {
        guardian: { contactId },
        student: student(),
        start: { kind: "walk-in", visitDate: yesterday },
      })

      // Wait until the creation waits on the Family lock.
      const waiting = async () =>
        (
          await holder.query<{ n: number }>(
            `select count(*)::int as n from pg_locks
             where locktype = 'advisory' and not granted and classid::int = hashtext('lead_family') and objid::int = hashtext($1)`,
            [contactId],
          )
        ).rows[0].n
      for (let tries = 0; (await waiting()) === 0; tries++) {
        if (tries > 100) throw new Error("the creation never waited on the Family lock")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      // It holds no phone lock while it waits.
      const free = await inRolledBackTransaction(async (other) => {
        const normalized = (await other.query<{ p: string }>("select public.normalize_phone($1) as p", [phone])).rows[0].p
        return (
          await other.query<{ got: boolean }>("select pg_try_advisory_xact_lock(hashtextextended('lead-phone:' || $1, 0)) as got", [
            normalized,
          ])
        ).rows[0].got
      })
      expect(free).toBe(true)

      await holder.query("rollback")
      await holder.query("begin")
      const created = await creating
      expect(created.ok).toBe(true)
      if (created.ok) expect(await resultOf(created.data.leadId)).toEqual({ result: "none", source: "auto", locked_result: null })
    })
  })
})

describe("a lead correction's lock order", () => {
  test("a rename with a class change takes the Family lock before the phone locks", async () => {
    const [child] = await family(await yearWithSchedule(), 1)
    const contactId = await contactOf(child)
    const lead = await getLead(await signedIn(ADMISSIONS), child)
    if (!lead.ok) throw new Error("setup failed")
    const phone = lead.data.contact.phone

    await inRolledBackTransaction(async (holder) => {
      await holder.query("select public.lock_families(array[$1::uuid])", [contactId])
      const correcting = updateLeadDetails(await signedIn(ADMISSIONS), child, {
        fullName: `Renamed ${randomUUID().slice(0, 8)}`,
        className: "STD 3",
      })

      const waiting = async () =>
        (
          await holder.query<{ n: number }>(
            `select count(*)::int as n from pg_locks
             where locktype = 'advisory' and not granted and classid::int = hashtext('lead_family') and objid::int = hashtext($1)`,
            [contactId],
          )
        ).rows[0].n
      for (let tries = 0; (await waiting()) === 0; tries++) {
        if (tries > 100) throw new Error("the correction never waited on the Family lock")
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      const free = await inRolledBackTransaction(async (other) => {
        const normalized = (await other.query<{ p: string }>("select public.normalize_phone($1) as p", [phone])).rows[0].p
        return (
          await other.query<{ got: boolean }>("select pg_try_advisory_xact_lock(hashtextextended('lead-phone:' || $1, 0)) as got", [
            normalized,
          ])
        ).rows[0].got
      })
      expect(free).toBe(true)

      await holder.query("rollback")
      await holder.query("begin")
      expect((await correcting).ok).toBe(true)
    })
  })
})

describe("today's rule, stored", () => {
  test("a new child on a contact with an Enrolled child holds the 10% from the start, and a Declined child follows the rule", async () => {
    const year = await yearWithSchedule()
    const [first, declined] = await family(year)
    expect((await declineLead(await signedIn(MANAGER), declined, { reason: "Other", explanation: "For the test." })).ok).toBe(true)
    await pay(first, FULL, "full_payment")
    expect(await resultOf(declined)).toEqual({ result: "ten", source: "auto", locked_result: null })

    const later = await createLead(await signedIn(ADMISSIONS), {
      guardian: { contactId: await contactOf(first) },
      student: student(),
      start: { kind: "walk-in", visitDate: yesterday },
    })
    if (!later.ok) throw new Error("setup failed")
    expect(await resultOf(later.data.leadId)).toEqual({ result: "ten", source: "auto", locked_result: null })
  })

  test("the Admission form's child on an unconfirmed contact holds none", async () => {
    const [known] = await family(await yearWithSchedule(), 1)
    await pay(known, FULL, "full_payment")
    const contact = await getLead(await signedIn(ADMISSIONS), known)
    if (!contact.ok) throw new Error("setup failed")
    const form = await createLead(secretClient(), {
      guardian: { contact: { fullName: "Typed On The Form", relationship: "Mother", phone: contact.data.contact.phone } },
      student: student(),
      start: { kind: "admission-form" },
    })
    if (!form.ok) throw new Error("setup failed")
    expect(await resultOf(form.data.leadId)).toEqual({ result: "none", source: "auto", locked_result: null })
    expect((await recordVisit(await signedIn(ADMISSIONS), form.data.leadId, today)).ok).toBe(true)
  })
})

describe("the audit trail", () => {
  test("every change to a stored result is in the audit log, in the lead's history scope", async () => {
    const [first, second] = await family(await yearWithSchedule())
    await pay(second, 720_000)
    await pay(first, FULL, "full_payment")
    await pay(second, WITH_SIBLING - 720_000, "first_instalment")

    const rows = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query<{ action: string; scope: string; actor_kind: string; old_values: Record<string, unknown> | null; new_values: Record<string, unknown> }>(
          "select action, scope, actor_kind, old_values, new_values from public.audit_log where table_name = 'lead_sibling_results' and lead_id = $1 order by id",
          [second],
        )
      ).rows,
    )
    // Gained the 10% when the first child enrolled, then locked it at its own
    // enrolment.
    expect(rows.map((row) => ({ action: row.action, scope: row.scope, actor: row.actor_kind }))).toEqual([
      { action: "insert", scope: "lead", actor: "staff" },
      { action: "update", scope: "lead", actor: "staff" },
    ])
    expect(rows[0].new_values).toMatchObject({ result: "ten", source: "auto", cause: "sibling" })
    expect(rows[1].old_values).toMatchObject({ source: "auto", locked_result: null })
    expect(rows[1].new_values).toMatchObject({ source: "locked", locked_result: "ten", cause: "payment" })
  })
})

describe("the table", () => {
  test("is readable with leads.view, written by nobody through the API, and never deleted", async () => {
    const [child] = await family(await yearWithSchedule(), 1)
    await pay(child, FULL, "full_payment")

    const staff = await signedIn(ADMISSIONS)
    const { data } = await staff.from("lead_sibling_results").select("lead_id, result, source").eq("lead_id", child)
    expect(data).toEqual([{ lead_id: child, result: "full", source: "locked" }])
    expect((await anonClient().from("lead_sibling_results").select("id").eq("lead_id", child)).data ?? []).toEqual([])
    expect((await staff.from("lead_sibling_results").update({ result: "ten" }).eq("lead_id", child)).error).not.toBeNull()
    expect((await staff.from("lead_sibling_results").delete().eq("lead_id", child)).error).not.toBeNull()
    await expect(asSystem((sql) => sql.query("delete from public.lead_sibling_results where lead_id = $1", [child]))).rejects.toThrow(
      /delete_refused/,
    )
    expect((await staff.from("sibling_rule_settings").select("id")).data ?? []).toEqual([])
  })
})

describe("the kill switch", () => {
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

