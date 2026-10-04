import { randomInt, randomUUID } from "node:crypto"

import type { Client } from "pg"
import { describe, expect, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { getLeadHistory } from "@/lib/services/audit"
import { getLeadInterviews, recordInterviewResult, registerForInterview, setInterviewFeeStatus } from "@/lib/services/interviews"
import { createLead } from "@/lib/services/leads"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER, type FixtureStaff } from "../support/fixtures"

// Marking the interview fee Paid or Not Paid through the interview module,
// against local Supabase. Each test registers a lead of its own; the seeded
// ones are only read.

const DAY = 24 * 60 * 60 * 1000
const today = tanzaniaToday()
const yesterday = tanzaniaToday(new Date(Date.now() - DAY))
const thisYear = Number(today.slice(0, 4))

// Slice 5's seeded Passed lead, whose fee is Paid at TZS 50,000.
const PAID = "1ead0000-0000-4000-8000-000000000503"

// A lead of the test's own, Visited and registered for interview, with no
// result yet and its fee Not Paid.
async function registeredLead() {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: {
      // A leading 6 keeps it clear of the seeded 700 000 numbers and of the
      // other test files' 07 numbers.
      contact: { fullName: "Fee Parent", relationship: "Father", phone: `06${String(randomInt(0, 100_000_000)).padStart(8, "0")}` },
    },
    student: { fullName: `Candidate ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
    start: { kind: "walk-in", visitDate: yesterday },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  const registered = await registerForInterview(await signedIn(ADMISSIONS), created.data.leadId)
  if (!registered.ok) throw new Error(`registration failed: ${registered.error}`)
  return { leadId: created.data.leadId, interviewId: registered.data.interviewId }
}

type Stored = { fee_status: string; locked_amount: number | null; locked_discount_applied?: boolean | null; result?: string | null }

async function stored(interviewId: string): Promise<Stored> {
  return inRolledBackTransaction(
    async (sql) =>
      (
        await sql.query<Stored>("select fee_status::text, locked_amount, locked_discount_applied, result::text from public.interviews where id = $1", [
          interviewId,
        ])
      ).rows[0],
  )
}

// Signs `sql`'s transaction in as a staff member, as their browser session
// would reach the database.
async function actAs(sql: Client, person: FixtureStaff) {
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [person.id])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  await sql.query("set local role authenticated")
}

// A test-only stand-in for slice 4's expected_interview_amount, answering as
// it will for a lead with an Approved agent's Referral code. Only `sql`'s
// transaction sees it, and rolling that back restores Wave 0's function, so
// tests running alongside never do.
async function discountedFee(sql: Client) {
  await sql.query(`
    create or replace function public.expected_interview_amount(lead_id uuid, out amount integer, out discount_applied boolean)
    language plpgsql stable security definer set search_path = '' as $$
    begin
        amount := 30000;
        discount_applied := true;
    end;
    $$`)
}

describe("marking the interview fee Paid", () => {
  test("locks the amount the fee comes to now, before any result exists", async () => {
    const { leadId, interviewId } = await registeredLead()
    const accountant = await signedIn(ACCOUNTANT)

    expect(await setInterviewFeeStatus(accountant, interviewId, "paid")).toEqual({
      ok: true,
      data: { feeStatus: "Paid", lockedAmount: 50000, discountApplied: false },
    })

    expect(await stored(interviewId)).toEqual({ fee_status: "Paid", locked_amount: 50000, locked_discount_applied: false, result: null })
    expect(await getLeadInterviews(accountant, leadId)).toMatchObject({
      ok: true,
      data: [{ feeStatus: "Paid", amount: 50000, discountApplied: false, result: null }],
    })
  })

  test("keeps the locked amount when what the fee comes to changes, and relocks at the new amount after Not Paid", async () => {
    const { interviewId } = await registeredLead()
    expect((await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")).ok).toBe(true)

    const seen = await inRolledBackTransaction(async (sql) => {
      await discountedFee(sql)
      await actAs(sql, ACCOUNTANT)
      const fee = async () =>
        (await sql.query<Stored>("select fee_status::text, locked_amount, locked_discount_applied from public.interviews where id = $1", [interviewId])).rows[0]
      const set = async (status: string) =>
        (await sql.query<{ answer: Record<string, unknown> }>("select public.set_interview_fee_status($1, $2) as answer", [interviewId, status]))
          .rows[0].answer

      const expected = (await sql.query("select amount, discount_applied from public.expected_interview_amount($1)", [
        (await sql.query("select lead from public.interviews where id = $1", [interviewId])).rows[0].lead,
      ])).rows[0]
      const whilePaid = await fee()
      const unlocked = await set("Not Paid")
      const afterUnlock = await fee()
      const relocked = await set("Paid")
      const afterRelock = await fee()
      return { expected, whilePaid, unlocked, afterUnlock, relocked, afterRelock }
    })

    // The fee now comes to TZS 30,000, but what was paid stays at 50,000.
    expect(seen.expected).toEqual({ amount: 30000, discount_applied: true })
    expect(seen.whilePaid).toEqual({ fee_status: "Paid", locked_amount: 50000, locked_discount_applied: false })
    // Not Paid releases the lock, and the next Paid takes the fee as it is then.
    expect(seen.unlocked).toMatchObject({ fee_status: "Not Paid", locked_amount: null })
    expect(seen.afterUnlock).toEqual({ fee_status: "Not Paid", locked_amount: null, locked_discount_applied: null })
    expect(seen.relocked).toEqual({ interview_id: interviewId, fee_status: "Paid", locked_amount: 30000, discount_applied: true })
    expect(seen.afterRelock).toEqual({ fee_status: "Paid", locked_amount: 30000, locked_discount_applied: true })
    // The stand-in went with the rollback.
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Paid", locked_amount: 50000 })
  })

  test("shows whether a locked amount included the discount from what was stored with it, not from the amount", async () => {
    const lock = async (amount: number, discounted: boolean) => {
      const { leadId, interviewId } = await registeredLead()
      await asSystem((sql) =>
        sql.query(
          "update public.interviews set fee_status = 'Paid', locked_amount = $2, locked_discount_applied = $3 where id = $1",
          [interviewId, amount, discounted],
        ),
      )
      return leadId
    }
    const staff = await signedIn(ADMISSIONS)
    expect(await getLeadInterviews(staff, await lock(30000, true))).toMatchObject({
      ok: true,
      data: [{ feeStatus: "Paid", amount: 30000, discountApplied: true }],
    })
    // A full fee lower than today's TZS 50,000, under other fee rules, is
    // still not the discounted fee.
    expect(await getLeadInterviews(staff, await lock(40000, false))).toMatchObject({
      ok: true,
      data: [{ feeStatus: "Paid", amount: 40000, discountApplied: false }],
    })
  })

  test("keeps the discount flag only while Paid", async () => {
    const { interviewId } = await registeredLead()
    await expect(
      asSystem((sql) =>
        sql.query("update public.interviews set locked_discount_applied = false where id = $1", [interviewId]),
      ),
    ).rejects.toThrow(/interviews_discount_locked_while_paid/)
    await expect(
      asSystem((sql) =>
        sql.query("update public.interviews set fee_status = 'Paid', locked_amount = 50000 where id = $1", [interviewId]),
      ),
    ).rejects.toThrow(/interviews_discount_locked_while_paid/)
  })

  test("leaves the result as it was, and a result recorded later leaves the fee", async () => {
    const { interviewId } = await registeredLead()
    await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")
    expect((await recordInterviewResult(await signedIn(ADMISSIONS), interviewId, { interviewDate: today, result: "Passed", score: 70 })).ok).toBe(
      true,
    )
    expect(await stored(interviewId)).toEqual({ fee_status: "Paid", locked_amount: 50000, locked_discount_applied: false, result: "Passed" })
  })
})

describe("marking the interview fee Not Paid", () => {
  test("releases the lock, and the panel shows what the fee comes to now", async () => {
    const { leadId, interviewId } = await registeredLead()
    const accountant = await signedIn(ACCOUNTANT)
    await setInterviewFeeStatus(accountant, interviewId, "paid")

    expect(await setInterviewFeeStatus(accountant, interviewId, "not_paid")).toEqual({
      ok: true,
      data: { feeStatus: "Not Paid", lockedAmount: null, discountApplied: false },
    })
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Not Paid", locked_amount: null })
    expect(await getLeadInterviews(accountant, leadId)).toMatchObject({
      ok: true,
      data: [{ feeStatus: "Not Paid", amount: 50000, discountApplied: false }],
    })
  })

  test("setting the status the fee already has is no_change, and writes nothing", async () => {
    const { leadId, interviewId } = await registeredLead()
    const accountant = await signedIn(ACCOUNTANT)
    const historyLength = async () => {
      const history = await getLeadHistory(await signedIn(MANAGER), leadId)
      if (!history.ok) throw new Error("history failed")
      return history.data.entries.length
    }

    const before = await historyLength()
    expect(await setInterviewFeeStatus(accountant, interviewId, "not_paid")).toEqual({ ok: false, error: "no_change" })
    await setInterviewFeeStatus(accountant, interviewId, "paid")
    expect(await setInterviewFeeStatus(accountant, interviewId, "paid")).toEqual({ ok: false, error: "no_change" })
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Paid", locked_amount: 50000 })
    expect(await historyLength()).toBe(before + 1)
  })
})

describe("the interview fee in the lead's history", () => {
  test("keeps each change with the amount, who and when", async () => {
    const { leadId, interviewId } = await registeredLead()
    const accountant = await signedIn(ACCOUNTANT)
    await setInterviewFeeStatus(accountant, interviewId, "paid")
    await setInterviewFeeStatus(accountant, interviewId, "not_paid")

    const history = await getLeadHistory(await signedIn(MANAGER), leadId)
    if (!history.ok) throw new Error("history failed")
    const changes = history.data.entries.filter((e) => e.record === "interviews" && e.action === "update")
    // Newest first.
    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ actor: ACCOUNTANT.name, recordId: interviewId, at: expect.any(String) })
    expect(changes[0].changes).toEqual(
      expect.arrayContaining([
        { field: "fee_status", from: "Paid", to: "Not Paid" },
        { field: "locked_amount", from: 50000, to: null },
        { field: "locked_discount_applied", from: false, to: null },
      ]),
    )
    expect(changes[1]).toMatchObject({ actor: ACCOUNTANT.name })
    expect(changes[1].changes).toEqual(
      expect.arrayContaining([
        { field: "fee_status", from: "Not Paid", to: "Paid" },
        { field: "locked_amount", from: null, to: 50000 },
        { field: "locked_discount_applied", from: null, to: false },
      ]),
    )
  })
})

describe("who may mark the interview fee", () => {
  test("a closed lead is refused", async () => {
    const { leadId, interviewId } = await registeredLead()
    await asSystem((sql) => sql.query("update public.leads set closure = 'Inactive', closure_reason = 'Duplicate record' where id = $1", [leadId]))

    expect(await setInterviewFeeStatus(await signedIn(ACCOUNTANT), interviewId, "paid")).toEqual({ ok: false, error: "lead_closed" })
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Not Paid", locked_amount: null })
  })

  test("Admissions Staff and the Manager are refused by the database itself", async () => {
    const { interviewId } = await registeredLead()
    for (const person of [ADMISSIONS, MANAGER]) {
      const client = await signedIn(person)
      expect(await setInterviewFeeStatus(client, interviewId, "paid"), person.name).toEqual({ ok: false, error: "forbidden" })
      // The same call straight to the database, past any screen.
      const direct = await client.rpc("set_interview_fee_status", { interview_id: interviewId, fee_status: "Paid" })
      expect(direct.error?.message, person.name).toBe("not_permitted")
    }
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Not Paid", locked_amount: null })
  })

  test("a deactivated staff member is refused", async () => {
    const { interviewId } = await registeredLead()
    expect(await setInterviewFeeStatus(await signedIn(DEACTIVATED), interviewId, "paid")).toEqual({ ok: false, error: "forbidden" })
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Not Paid" })
  })

  test("nobody outside a staff session may mark it, the secret key included", async () => {
    const { interviewId } = await registeredLead()
    const anon = await anonClient().rpc("set_interview_fee_status", { interview_id: interviewId, fee_status: "Paid" })
    expect(anon.error?.code).toBe("42501")
    for (const client of [anonClient(), secretClient()]) {
      expect(await setInterviewFeeStatus(client, interviewId, "paid")).toEqual({ ok: false, error: "forbidden" })
    }
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Not Paid", locked_amount: null })
  })

  test("an interview that does not exist is not found", async () => {
    const accountant = await signedIn(ACCOUNTANT)
    expect(await setInterviewFeeStatus(accountant, randomUUID(), "paid")).toEqual({ ok: false, error: "not_found" })
    expect(await setInterviewFeeStatus(accountant, "not-an-id", "paid")).toEqual({ ok: false, error: "not_found" })
  })

  test("a status other than Paid or Not Paid changes nothing", async () => {
    const { interviewId } = await registeredLead()
    const answer = await (await signedIn(ACCOUNTANT)).rpc("set_interview_fee_status", { interview_id: interviewId, fee_status: "Waived" })
    expect(answer.error?.message).toBe("invalid_status")
    expect(await stored(interviewId)).toMatchObject({ fee_status: "Not Paid", locked_amount: null })
  })
})

describe("the seeded fee", () => {
  test("shows the Paid lead with its locked amount", async () => {
    expect(await getLeadInterviews(await signedIn(ADMISSIONS), PAID)).toMatchObject({
      ok: true,
      data: [{ feeStatus: "Paid", amount: 50000, discountApplied: false, result: "Passed" }],
    })
  })

  test("shows in the Paid lead's history as marked Paid by the Accountant", async () => {
    const history = await getLeadHistory(await signedIn(MANAGER), PAID)
    if (!history.ok) throw new Error("history failed")
    const payments = history.data.entries.filter(
      (e) => e.record === "interviews" && e.action === "update" && e.changes.some((c) => c.field === "fee_status"),
    )
    expect(payments).toHaveLength(1)
    expect(payments[0]).toMatchObject({ actor: ACCOUNTANT.name })
    expect(payments[0].changes).toEqual(
      expect.arrayContaining([
        { field: "fee_status", from: "Not Paid", to: "Paid" },
        { field: "locked_amount", from: null, to: 50000 },
      ]),
    )
  })
})
