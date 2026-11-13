import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { checkPromoCodeAvailable, createPromoCode, getPromoCodeImpact, listPromoCodes, setPromoCodeState, updatePromoCode } from "@/lib/services/promo-codes"
import { findDiscountCode, getLeadReferral, setLeadReferralCode } from "@/lib/services/referral"

import { agentWithLogin } from "../support/agent-students"
import { anonClient, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { actAs, discountPhone, expectedFee, freshCode, leadWithCode, lockedAmount, payInterview } from "../support/discount-codes"
import { ADMISSIONS, MANAGER } from "../support/fixtures"

// Promo codes (owner decisions of 2026-11-09): school codes with a name and
// an amount, never tied to an agent. One namespace with agent codes. Active
// gives the discount, Paused nothing until resumed, Ended is final, and an
// Active code past its last day is Expired. A Paid fee never moves.

async function newPromo(amount = 25000, code = freshCode("P")) {
  const made = await createPromoCode(await signedIn(MANAGER), { name: `Instagram ${code}`, code, amount, endsOn: null, note: null })
  if (!made.ok) throw new Error(`could not create ${code}: ${made.error}`)
  return made.data
}

describe("who may manage Promo codes", () => {
  test("staff without discount_codes.manage are refused every write and impact, and a signed-out visitor every call", async () => {
    const promo = await newPromo()
    const calls = [
      ["create_promo_code", { name: "Nope", code: freshCode("N"), amount: 1000, ends_on: null, note: null }],
      ["update_promo_code", { id: promo.id, name: "Nope", amount: 1000, ends_on: null, note: null, reason: "x" }],
      ["set_promo_code_state", { id: promo.id, state: "paused", reason: "x" }],
      ["promo_code_fee_impact", { id: promo.id, amount: 1000, state: null, ends_on: null, ends_on_given: false }],
    ] as const
    for (const client of [await signedIn(ADMISSIONS), await signedIn(await createThrowawayStaff(["leads.view"]))]) {
      for (const [fn, args] of calls) {
        const { error } = await client.rpc(fn, args)
        expect(error?.message, fn).toBe("not_permitted")
      }
    }
    for (const [fn, args] of [...calls, ["list_promo_codes", {}], ["find_discount_code", { typed_code: promo.code }]] as const) {
      const { error } = await anonClient().rpc(fn, args)
      expect(error?.code, fn).toBe("42501")
    }
    expect(await listPromoCodes(await signedIn(await createThrowawayStaff([])))).toEqual({ ok: false, error: "forbidden" })
  })

  test("staff who may view leads read the list, the table and a typed code, but nobody writes the table directly", async () => {
    const promo = await newPromo(15000)
    const admissions = await signedIn(ADMISSIONS)
    const list = await listPromoCodes(admissions)
    expect(list.ok && list.data.find((p) => p.id === promo.id)).toMatchObject({
      code: promo.code,
      amount: 15000,
      state: "active",
      effectiveState: "active",
      studentCount: 0,
      unpaidCount: 0,
    })
    expect(await findDiscountCode(admissions, promo.code.toLowerCase())).toEqual({
      ok: true,
      data: expect.objectContaining({ kind: "promo", code: promo.code, state: "active", amountOff: 15000, agentId: null }),
    })
    const insert = await admissions.from("promo_codes").insert({ code: freshCode("D"), name: "Direct", amount: 1 })
    expect(insert.error).not.toBeNull()
    const nobody = await signedIn(await createThrowawayStaff([]))
    expect((await nobody.from("promo_codes").select("id").eq("id", promo.id)).data).toEqual([])
    expect(await findDiscountCode(nobody, promo.code)).toEqual({ ok: true, data: null })
  })
})

describe("creating a Promo code", () => {
  test("stores the code as typed in capitals without spaces, and records the creation", async () => {
    const code = freshCode("C")
    const typed = ` ${code.slice(0, 4).toLowerCase()} ${code.slice(4)} `
    const made = await createPromoCode(await signedIn(MANAGER), { name: "  Radio   Kheri ", code: typed, amount: 5000, endsOn: null, note: " For radio " })
    expect(made).toEqual({ ok: true, data: expect.objectContaining({ code }) })
    const row = await inRolledBackTransaction(async (sql) => {
      const promo = await sql.query("select code, name, note, amount, state, created_by from public.promo_codes where code = $1", [code])
      const history = await sql.query("select kind, new_value, student_count from public.discount_amount_changes where promo_code_id = $1", [
        made.ok ? made.data.id : null,
      ])
      return { promo: promo.rows[0], history: history.rows }
    })
    expect(row.promo).toEqual({ code, name: "Radio Kheri", note: "For radio", amount: 5000, state: "active", created_by: MANAGER.id })
    expect(row.history).toEqual([{ kind: "promo_created", new_value: "5000", student_count: 0 }])
  })

  test("refuses a bad code, name, amount, a past last day and a code already used", async () => {
    const manager = await signedIn(MANAGER)
    const base = { name: "Good", code: freshCode("B"), amount: 5000, endsOn: null, note: null }
    expect(await createPromoCode(manager, { ...base, code: "AB1" })).toEqual({ ok: false, error: "invalid-code" })
    expect(await createPromoCode(manager, { ...base, code: "ABC-123" })).toEqual({ ok: false, error: "invalid-code" })
    expect(await createPromoCode(manager, { ...base, name: " " })).toEqual({ ok: false, error: "invalid-name" })
    expect(await createPromoCode(manager, { ...base, amount: 60000 })).toEqual({ ok: false, error: "invalid-amount" })
    expect(await createPromoCode(manager, { ...base, endsOn: "2020-01-01" })).toEqual({ ok: false, error: "invalid-ends-on" })
    expect(await createPromoCode(manager, { ...base, note: "x".repeat(201) })).toEqual({ ok: false, error: "invalid-note" })
    const promo = await newPromo()
    expect(await createPromoCode(manager, { ...base, code: promo.code })).toEqual({ ok: false, error: "code-taken" })
  })
})

describe("one code namespace", () => {
  test("a Promo code may not take an agent's code, current or retired", async () => {
    const code = freshCode("A")
    const manager = await signedIn(MANAGER)
    const agent = await manager.rpc("create_marketing_agent", {
      full_name: `Juma Namespace ${randomUUID().slice(0, 6)}`,
      phone: discountPhone(),
      whatsapp: "",
      email: "",
      code,
    })
    expect((agent.data as { outcome: string }).outcome).toBe("created")
    expect(await createPromoCode(manager, { name: "Clash", code, amount: 5000, endsOn: null, note: null })).toEqual({ ok: false, error: "code-taken" })
    expect(await checkPromoCodeAvailable(manager, code)).toEqual({ ok: true, data: { kind: "agent", code } })

    const retiredCode = freshCode("R")
    const retiring = await manager.rpc("create_marketing_agent", {
      full_name: `Retiring Namespace ${randomUUID().slice(0, 6)}`,
      phone: discountPhone(),
      whatsapp: "",
      email: "",
      code: retiredCode,
    })
    const retiringId = (retiring.data as { agent: { id: string } }).agent.id
    expect((await manager.rpc("change_marketing_agent_status", { agent_id: retiringId, kind: "retired", reason: "Left" })).error).toBeNull()
    expect(await createPromoCode(manager, { name: "Retired clash", code: retiredCode, amount: 5000, endsOn: null, note: null })).toEqual({
      ok: false,
      error: "code-taken",
    })
  })

  test("an agent may not take a Promo code's code, through create, check and the agent import", async () => {
    const promo = await newPromo()
    const manager = await signedIn(MANAGER)
    const draft = { full_name: `Asha Namespace ${randomUUID().slice(0, 6)}`, phone: discountPhone(), whatsapp: "", email: "", code: promo.code }
    const created = await manager.rpc("create_marketing_agent", draft)
    expect(created.error?.message).toBe("code_taken")
    const checked = await manager.rpc("check_marketing_agent", draft)
    expect(checked.error?.message).toBe("code_taken")
    const imported = await manager.rpc("check_agent_import", {
      rows: [{ sheet_row: 2, code: promo.code, full_name: draft.full_name, phone: draft.phone, whatsapp: null, email: null }],
    })
    expect(imported.data).toEqual([{ sheet_row: 2, verdict: { verdict: "promo_code" } }])
    // The trigger holds even for the database owner.
    const direct = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      return sql
        .query("insert into public.marketing_agents (full_name, phone, code) values ('Direct Clash', $1, $2)", [discountPhone(), promo.code])
        .then(() => "inserted", (error: Error) => error.message)
    })
    expect(direct).toBe("code_taken")
    expect(await checkPromoCodeAvailable(manager, promo.code)).toEqual({
      ok: true,
      data: { kind: "promo-code", code: promo.code, name: expect.any(String) },
    })
    expect(await checkPromoCodeAvailable(manager, freshCode("F"))).toMatchObject({ ok: true, data: { kind: "available" } })
    expect(await checkPromoCodeAvailable(manager, "ab")).toEqual({ ok: true, data: { kind: "invalid" } })
  })
})

describe("a lead carrying a Promo code", () => {
  test("pays the full fee less the code's amount while Active, and nothing off while Paused or Ended; a Paid fee never moves", async () => {
    const promo = await newPromo(25000)
    const unpaid = await leadWithCode(null)
    const paid = await leadWithCode(null)
    const admissions = await signedIn(ADMISSIONS)
    expect(await setLeadReferralCode(admissions, unpaid, promo.code.toLowerCase())).toEqual({ ok: true, data: { code: promo.code } })
    expect(await setLeadReferralCode(admissions, paid, promo.code)).toEqual({ ok: true, data: { code: promo.code } })
    expect(await payInterview(paid)).toBe(25000)

    const referral = await getLeadReferral(admissions, unpaid)
    expect(referral).toEqual({
      ok: true,
      data: expect.objectContaining({
        code: promo.code,
        kind: "promo",
        holderName: `Instagram ${promo.code}`,
        discountState: "active",
        state: "approved",
        agentName: null,
        amount: 25000,
        amountOff: 25000,
        discountApplied: true,
        promoCodeId: promo.id,
      }),
    })
    expect((await secretClient().rpc("discount_code_estimate", { code: promo.code }).single()).data).toEqual({ state: "approved", amount: 25000 })

    const manager = await signedIn(MANAGER)
    expect(await getPromoCodeImpact(manager, promo.id, { state: "paused" })).toEqual({
      ok: true,
      data: [expect.objectContaining({ leadId: unpaid, feeNow: 25000, feeAfter: 50000 })],
    })
    expect(await setPromoCodeState(manager, promo.id, "paused", "Campaign on hold")).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await inRolledBackTransaction((sql) => expectedFee(sql, unpaid))).toBe(50000)
    expect((await secretClient().rpc("discount_code_estimate", { code: promo.code }).single()).data).toEqual({ state: "switched_off", amount: 50000 })
    expect(await setPromoCodeState(manager, promo.id, "paused", "Again")).toEqual({ ok: false, error: "no-change" })

    expect(await setPromoCodeState(manager, promo.id, "active", "Back on")).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await updatePromoCode(manager, promo.id, { name: `Instagram ${promo.code}`, amount: 30000, endsOn: null, note: null, reason: "Bigger push" })).toEqual({
      ok: true,
      data: { feeChangeCount: 1 },
    })
    expect(await inRolledBackTransaction((sql) => expectedFee(sql, unpaid))).toBe(20000)

    expect(await setPromoCodeState(manager, promo.id, "ended", "Campaign over")).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await inRolledBackTransaction((sql) => expectedFee(sql, unpaid))).toBe(50000)
    // The Paid fee keeps the amount the family paid through every change.
    expect(await lockedAmount(paid)).toBe(25000)

    // Ended is final, and the lead keeps the code in its history.
    expect(await setPromoCodeState(manager, promo.id, "active", "Undo")).toEqual({ ok: false, error: "ended" })
    expect(await updatePromoCode(manager, promo.id, { name: "Renamed", amount: 30000, endsOn: null, note: null, reason: null })).toEqual({
      ok: false,
      error: "ended",
    })
    expect(await getLeadReferral(admissions, unpaid)).toMatchObject({
      ok: true,
      data: { code: promo.code, kind: "promo", discountState: "ended", state: "switched_off", amountOff: 0 },
    })
    // A lead may still be given an Ended code: the amount follows the state.
    const later = await leadWithCode(null)
    expect(await setLeadReferralCode(admissions, later, promo.code)).toEqual({ ok: true, data: { code: promo.code } })

    const list = await listPromoCodes(admissions)
    expect(list.ok && list.data.find((p) => p.id === promo.id)).toMatchObject({ state: "ended", studentCount: 3, unpaidCount: 2 })
  })

  test("an edit needs a reason only when the amount or the last day changes", async () => {
    const promo = await newPromo(10000)
    const manager = await signedIn(MANAGER)
    const name = `Instagram ${promo.code}`
    expect(await updatePromoCode(manager, promo.id, { name, amount: 12000, endsOn: null, note: null, reason: null })).toEqual({
      ok: false,
      error: "invalid-reason",
    })
    expect(await updatePromoCode(manager, promo.id, { name: `${name} 2`, amount: 10000, endsOn: null, note: "Renamed", reason: null })).toEqual({
      ok: true,
      data: { feeChangeCount: 0 },
    })
    expect(await updatePromoCode(manager, promo.id, { name: `${name} 2`, amount: 10000, endsOn: null, note: "Renamed", reason: null })).toEqual({
      ok: false,
      error: "no-change",
    })
    expect(await updatePromoCode(manager, promo.id, { name: `${name} 2`, amount: 10000, endsOn: "2020-01-01", note: "Renamed", reason: "Ends" })).toEqual({
      ok: false,
      error: "invalid-ends-on",
    })
  })

  test("an Active code past its last day reads as Expired and takes nothing off", async () => {
    const promo = await newPromo(20000)
    const lead = await leadWithCode(promo.code)
    const answer = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.promo_codes set ends_on = current_date - 3 where id = $1", [promo.id])
      const state = await sql.query<{ effective: string }>("select public.effective_state(p) as effective from public.promo_codes p where id = $1", [
        promo.id,
      ])
      return { state: state.rows[0].effective, fee: await expectedFee(sql, lead) }
    })
    expect(answer).toEqual({ state: "expired", fee: 50000 })
  })

  test("on its last day a code still takes its amount off, so a pause preview lists the fee it would raise", async () => {
    const promo = await newPromo(20000)
    const lead = await leadWithCode(promo.code)
    // Today in Tanzania, read inside one transaction, so the hour and time
    // zone the test runs at can't move the day.
    const lastDay = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.promo_codes set ends_on = public.tanzania_today() where id = $1", [promo.id])
      const state = await sql.query<{ effective: string }>("select public.effective_state(p) as effective from public.promo_codes p where id = $1", [
        promo.id,
      ])
      await actAs(sql, MANAGER.id)
      const { rows } = await sql.query<{ impact: { lead_id: string; fee_now: number; fee_after: number }[] }>(
        "select public.promo_code_fee_impact($1, null, 'paused', null, false) as impact",
        [promo.id],
      )
      return {
        state: state.rows[0].effective,
        fee: await expectedFee(sql, lead),
        pausing: rows[0].impact.map((row) => [row.lead_id, row.fee_now, row.fee_after]),
      }
    })
    expect(lastDay).toEqual({ state: "active", fee: 30000, pausing: [[lead, 30000, 50000]] })
  })

  test("a new last day shows the fees it moves before it is saved", async () => {
    const promo = await newPromo(20000)
    const lead = await leadWithCode(promo.code)
    const manager = await signedIn(MANAGER)
    // A last day still to come, or none, moves nothing.
    expect(await getPromoCodeImpact(manager, promo.id, { endsOn: "2099-12-31" })).toEqual({ ok: true, data: [] })
    expect(await getPromoCodeImpact(manager, promo.id, { endsOn: null })).toEqual({ ok: true, data: [] })
    // A new last day already past is refused, as the save refuses it.
    expect(await getPromoCodeImpact(manager, promo.id, { endsOn: "2020-01-01" })).toEqual({ ok: false, error: "invalid-ends-on" })
    expect(await getPromoCodeImpact(manager, promo.id, { amount: 25000, endsOn: "2020-01-01" })).toEqual({ ok: false, error: "invalid-ends-on" })
    // An expired code given a later day gives its amount again, the new amount if that changes too.
    const restored = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.promo_codes set ends_on = current_date - 3 where id = $1", [promo.id])
      await actAs(sql, MANAGER.id)
      const impact = (amount: number | null, given: boolean) =>
        sql
          .query<{ impact: { lead_id: string; fee_now: number; fee_after: number }[] }>(
            "select public.promo_code_fee_impact($1, $2, null, current_date + 30, $3) as impact",
            [promo.id, amount, given],
          )
          .then(({ rows }) => rows[0].impact.map((row) => [row.lead_id, row.fee_now, row.fee_after]))
      // The expired code's own past day, sent back unchanged with a new
      // amount, still previews: nothing moves while it stays expired.
      const unchanged = await sql.query<{ impact: unknown[] }>(
        "select public.promo_code_fee_impact($1, 25000, null, current_date - 3, true) as impact",
        [promo.id],
      )
      return {
        kept: await impact(null, false),
        extended: await impact(null, true),
        both: await impact(35000, true),
        unchanged: unchanged.rows[0].impact,
      }
    })
    expect(restored).toEqual({ kept: [], extended: [[lead, 50000, 30000]], both: [[lead, 50000, 15000]], unchanged: [] })
  })

  test("the code never changes, Ended never comes back, and no Promo code is deleted, whoever writes", async () => {
    const promo = await newPromo()
    const outcome = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const attempt = async (query: string) => {
        await sql.query("savepoint s")
        const answer = await sql.query(query, [promo.id]).then(() => "done", (error: Error) => error.message)
        await sql.query("rollback to savepoint s")
        return answer
      }
      const code = await attempt("update public.promo_codes set code = 'CHANGED1' where id = $1")
      const remove = await attempt("delete from public.promo_codes where id = $1")
      await sql.query("update public.promo_codes set state = 'ended' where id = $1", [promo.id])
      const back = await attempt("update public.promo_codes set state = 'active' where id = $1")
      return { code, remove, back }
    })
    expect(outcome).toEqual({ code: "promo_code_locked", remove: "delete_refused", back: "promo_code_ended" })
  })
})

describe("the agent portal", () => {
  test("never lists a lead carrying a Promo code", async () => {
    const agent = await agentWithLogin()
    const promo = await newPromo()
    const own = await leadWithCode(agent.code, `Portal Own ${randomInt(1000, 9999)}`)
    const promoLead = await leadWithCode(promo.code, `Portal Promo ${randomInt(1000, 9999)}`)
    const client = await signedIn(agent)
    const { data, error } = await client.rpc("agent_students", { search: null, page_limit: 100, page_offset: 0 })
    expect(error).toBeNull()
    const text = JSON.stringify(data)
    expect(text).not.toContain(promoLead)
    expect(text).not.toContain("Portal Promo")
    expect(own).toBeTruthy()
  })
})
