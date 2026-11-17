import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { checkPromoCodeAvailable, createPromoCode, getPromoCodeImpact, listPromoCodes, setPromoCodeState, updatePromoCode } from "@/lib/services/promo-codes"
import { findDiscountCode, getLeadReferral, setLeadReferralCode } from "@/lib/services/referral"
import { exportStudents } from "@/lib/services/student-export"

import { agentWithLogin } from "../support/agent-students"
import { anonClient, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { actAs, discountPhone, expectedFee, freshAgentCode, freshCode, leadWithCode, lockedAmount, payInterview } from "../support/discount-codes"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

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
    for (const code of ["", "ABC--1", "abc --1", "1".repeat(16), "KODI€"]) {
      expect(await createPromoCode(manager, { ...base, code })).toEqual({ ok: false, error: "invalid-code" })
    }
    expect(await createPromoCode(manager, { ...base, name: " " })).toEqual({ ok: false, error: "invalid-name" })
    expect(await createPromoCode(manager, { ...base, amount: 60000 })).toEqual({ ok: false, error: "invalid-amount" })
    expect(await createPromoCode(manager, { ...base, endsOn: "2020-01-01" })).toEqual({ ok: false, error: "invalid-ends-on" })
    expect(await createPromoCode(manager, { ...base, note: "x".repeat(201) })).toEqual({ ok: false, error: "invalid-note" })
    const promo = await newPromo()
    expect(await createPromoCode(manager, { ...base, code: promo.code })).toEqual({ ok: false, error: "code-taken" })
  })
})

describe("one code namespace", () => {
  // A code and its twin across the box's hyphen are one code: ABC123 is
  // ABC-123 (#462).
  test("a Promo code may not take an agent's code or its twin, current or retired", async () => {
    const code = freshAgentCode("A")
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
    const twin = code.replace("-", "")
    expect(await createPromoCode(manager, { name: "Clash", code: twin, amount: 5000, endsOn: null, note: null })).toEqual({ ok: false, error: "code-taken" })
    expect(await checkPromoCodeAvailable(manager, twin)).toEqual({ ok: true, data: { kind: "agent", code: twin } })

    const retiredCode = freshAgentCode("R")
    const retiring = await manager.rpc("create_marketing_agent", {
      full_name: `Retiring Namespace ${randomUUID().slice(0, 6)}`,
      phone: discountPhone(),
      whatsapp: "",
      email: "",
      code: retiredCode,
    })
    const retiringId = (retiring.data as { agent: { id: string } }).agent.id
    expect((await manager.rpc("change_marketing_agent_status", { agent_id: retiringId, kind: "retired", reason: "Left" })).error).toBeNull()
    expect(await createPromoCode(manager, { name: "Retired clash", code: retiredCode.replace("-", ""), amount: 5000, endsOn: null, note: null })).toEqual({
      ok: false,
      error: "code-taken",
    })
  })

  test("an agent may not take a Promo code's twin, through create, check and the agent import", async () => {
    const agentCode = freshAgentCode("Y")
    const promo = await newPromo(25000, agentCode.replace("-", ""))
    const manager = await signedIn(MANAGER)
    const draft = { full_name: `Asha Namespace ${randomUUID().slice(0, 6)}`, phone: discountPhone(), whatsapp: "", email: "", code: agentCode }
    const created = await manager.rpc("create_marketing_agent", draft)
    expect(created.error?.message).toBe("code_taken")
    const checked = await manager.rpc("check_marketing_agent", draft)
    expect(checked.error?.message).toBe("code_taken")
    const imported = await manager.rpc("check_agent_import", {
      rows: [{ sheet_row: 2, code: agentCode, full_name: draft.full_name, phone: draft.phone, whatsapp: null, email: null }],
    })
    expect(imported.data).toEqual([{ sheet_row: 2, verdict: { verdict: "promo_code" } }])
    // The trigger holds even for the database owner.
    const direct = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      return sql
        .query("insert into public.marketing_agents (full_name, phone, code) values ('Direct Clash', $1, $2)", [discountPhone(), agentCode])
        .then(() => "inserted", (error: Error) => error.message)
    })
    expect(direct).toBe("code_taken")
    expect(await checkPromoCodeAvailable(manager, promo.code)).toEqual({
      ok: true,
      data: { kind: "promo-code", code: promo.code, name: expect.any(String) },
    })
    expect(await checkPromoCodeAvailable(manager, freshCode("F"))).toMatchObject({ ok: true, data: { kind: "available" } })
    expect(await checkPromoCodeAvailable(manager, "kodi€")).toEqual({ ok: true, data: { kind: "invalid" } })
    expect(await checkPromoCodeAvailable(manager, "ABC--1")).toEqual({ ok: true, data: { kind: "invalid" } })
  })
})

describe("Promo codes in any format (#462)", () => {
  test("takes letters, numbers and symbols in any mix, stored without spaces in capitals", async () => {
    const tag = randomUUID().replace(/-/g, "").slice(0, 6).toUpperCase()
    for (const [typed, stored] of [
      [`save${tag}`, `SAVE${tag}`],
      [`$ave${tag}`, `$AVE${tag}`],
      [`as-${tag}`, `AS-${tag}`],
      [`50% off ${tag}`, `50%OFF${tag}`],
      [`${tag}!#&=;,'"<>/.:?@[]{}|~`.slice(0, 15), `${tag}!#&=;,'"<>/.:?@[]{}|~`.slice(0, 15)],
    ]) {
      const made = await createPromoCode(await signedIn(MANAGER), { name: `Any ${typed}`, code: typed, amount: 1000, endsOn: null, note: null })
      expect(made).toMatchObject({ ok: true, data: { code: stored } })
    }
  })

  test("the table itself refuses a code that isn't one, even from the database owner", async () => {
    for (const code of ["", "KODI€", "save 10", "1".repeat(16), "ABC--1"]) {
      const answer = await inRolledBackTransaction(async (sql) => {
        await sql.query("select public.set_audit_actor('system')")
        return sql
          .query("insert into public.promo_codes (code, name, amount) values ($1, 'Direct', 1000)", [code])
          .then(() => "inserted", (error: Error) => error.message)
      })
      expect(answer, code).toMatch(/promo_codes_code_check/)
    }
  })

  test("ABC123 and ABC-123 are one code: a Promo code can't be an agent code's twin, nor another Promo code's", async () => {
    const manager = await signedIn(MANAGER)
    const agentCode = freshAgentCode("W")
    const agent = await manager.rpc("create_marketing_agent", {
      full_name: `Twin Namespace ${randomUUID().slice(0, 6)}`,
      phone: discountPhone(),
      whatsapp: "",
      email: "",
      code: agentCode,
    })
    expect((agent.data as { outcome: string }).outcome).toBe("created")
    const twin = agentCode.replace("-", "")
    expect(await checkPromoCodeAvailable(manager, twin)).toEqual({ ok: true, data: { kind: "agent", code: twin } })
    expect(await createPromoCode(manager, { name: "Agent twin", code: twin, amount: 1000, endsOn: null, note: null })).toEqual({
      ok: false,
      error: "code-taken",
    })

    const promo = await newPromo(1000, `EID${randomInt(10_000, 100_000)}`)
    const hyphened = `${promo.code.slice(0, 3)}-${promo.code.slice(3)}`
    expect(await checkPromoCodeAvailable(manager, hyphened)).toMatchObject({ ok: true, data: { kind: "promo-code", code: hyphened } })
    expect(await createPromoCode(manager, { name: "Promo twin", code: hyphened, amount: 1000, endsOn: null, note: null })).toEqual({
      ok: false,
      error: "code-taken",
    })
  })
})

describe("a Promo code may take an agent's shape (owner, 2026-11-17)", () => {
  test("a free ABC-123 is a Promo code, and then no agent may take it or its twin", async () => {
    const manager = await signedIn(MANAGER)
    const code = freshAgentCode("P")
    expect(await checkPromoCodeAvailable(manager, code)).toEqual({ ok: true, data: { kind: "available", code } })
    const promo = await newPromo(1000, code)
    expect(promo.code).toBe(code)
    const draft = { full_name: `Shape Twin ${randomUUID().slice(0, 6)}`, phone: discountPhone(), whatsapp: "", email: "", code }
    expect((await manager.rpc("create_marketing_agent", draft)).error?.message).toBe("code_taken")
    // Its twin is a Promo code's twin too.
    expect(await createPromoCode(manager, { name: "Twin", code: code.replace("-", ""), amount: 1000, endsOn: null, note: null })).toEqual({
      ok: false,
      error: "code-taken",
    })
  })
})

describe("agent codes are exactly ABC-123 (#462)", () => {
  test("a typed code of another shape is refused on create, and the database refuses any new one", async () => {
    const manager = await signedIn(MANAGER)
    for (const code of ["AB-123", "ABCD-123", "ABC-1234", "ABC123", "KARIBU2026", "$AVE"]) {
      const answer = await manager.rpc("create_marketing_agent", {
        full_name: `Shape Agent ${randomUUID().slice(0, 6)}`,
        phone: discountPhone(),
        whatsapp: "",
        email: "",
        code,
      })
      expect(answer.error?.message).toBe("invalid")
      expect(JSON.parse(answer.error?.details ?? "{}")).toEqual({ field: "code" })
    }
    const direct = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      return sql
        .query("insert into public.marketing_agents (full_name, phone, code) values ('Direct Shape', $1, 'AB-12')", [discountPhone()])
        .then(() => "inserted", (error: Error) => error.message)
    })
    expect(direct).toBe("invalid")
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

// Owner, 2026-11-17: a code typed before it was announced gives nothing. An
// imported record is a family's record, not a new application, and keeps
// the code whenever it was imported.
describe("only applications sent after the code was created get its discount (#471)", () => {
  async function promoHistory(id: string) {
    return inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ kind: string; student_count: number; lead_ids: string[] }>(
        "select kind, student_count, lead_ids from public.discount_amount_changes where promo_code_id = $1 order by sequence",
        [id],
      )
      return rows
    })
  }

  async function exportedFee(leadId: string): Promise<string> {
    const admissionNumber = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ admission_number: string }>("select admission_number from public.leads where id = $1", [leadId])
      return rows[0].admission_number
    })
    const result = await exportStudents(await signedIn(SUPER_ADMIN), { query: admissionNumber }, ["admission_number", "interview_fee_amount"])
    if (!result.ok) throw new Error(JSON.stringify(result.error))
    return result.data.rows[0][1]
  }

  test("an application that carried the code before then never gets it, now or on any later read", async () => {
    const code = freshCode("E")
    const early = await leadWithCode(code)
    const earlyWithout = await leadWithCode(null)
    const promo = await newPromo(25000, code)
    // Creating the code moved no fee.
    expect(await promoHistory(promo.id)).toEqual([{ kind: "promo_created", student_count: 0, lead_ids: [] }])

    const admissions = await signedIn(ADMISSIONS)
    expect(await getLeadReferral(admissions, early)).toEqual({
      ok: true,
      data: expect.objectContaining({
        code,
        kind: "promo",
        discountState: "active",
        amount: 50000,
        amountOff: 0,
        discountApplied: false,
        sentBeforeCode: true,
        promoCodeId: promo.id,
      }),
    })
    // Staff putting the code on an application sent before it existed gives nothing either.
    expect(await setLeadReferralCode(admissions, earlyWithout, code)).toEqual({ ok: true, data: { code } })
    expect(await inRolledBackTransaction((sql) => expectedFee(sql, earlyWithout))).toBe(50000)

    // An application sent after it gets it.
    const later = await leadWithCode(code)
    expect(await getLeadReferral(admissions, later)).toMatchObject({ ok: true, data: { amount: 25000, amountOff: 25000, sentBeforeCode: false } })

    // The Referral code editor's lookup states the same for each application.
    expect(await findDiscountCode(admissions, code.toLowerCase(), { leadId: early })).toEqual({
      ok: true,
      data: expect.objectContaining({ kind: "promo", code, state: "active", amountOff: 0, sentBeforeCode: true }),
    })
    expect(await findDiscountCode(admissions, code, { leadId: later })).toEqual({
      ok: true,
      data: expect.objectContaining({ kind: "promo", code, amountOff: 25000, sentBeforeCode: false }),
    })
    expect(await findDiscountCode(await signedIn(await createThrowawayStaff([])), code, { leadId: early })).toEqual({ ok: true, data: null })

    // Every change counts and lists only the later application.
    const manager = await signedIn(MANAGER)
    expect(await getPromoCodeImpact(manager, promo.id, { state: "paused" })).toEqual({
      ok: true,
      data: [expect.objectContaining({ leadId: later, feeNow: 25000, feeAfter: 50000 })],
    })
    expect(await setPromoCodeState(manager, promo.id, "paused", "On hold")).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await setPromoCodeState(manager, promo.id, "active", "Back on")).toEqual({ ok: true, data: { feeChangeCount: 1 } })
    expect(await updatePromoCode(manager, promo.id, { name: `Instagram ${code}`, amount: 30000, endsOn: null, note: null, reason: "Bigger" })).toEqual({
      ok: true,
      data: { feeChangeCount: 1 },
    })
    expect(await inRolledBackTransaction((sql) => expectedFee(sql, early))).toBe(50000)
    expect(await inRolledBackTransaction((sql) => expectedFee(sql, later))).toBe(20000)

    // The export states the same fees, and the early payment locks the full fee.
    const interviews: string[] = []
    for (const leadId of [early, later]) {
      const registered = await admissions.rpc("register_for_interview", { lead_id: leadId })
      expect(registered.error).toBeNull()
      interviews.push((registered.data as { interview_id: string }).interview_id)
    }
    expect(await exportedFee(early)).toBe("50000")
    expect(await exportedFee(later)).toBe("20000")
    const paid = await (await signedIn(ACCOUNTANT)).rpc("set_interview_fee_status", { interview_id: interviews[0], fee_status: "Paid" })
    expect(paid.data).toMatchObject({ locked_amount: 50000, discount_applied: false })

    // The list still counts every student carrying the code.
    const list = await listPromoCodes(admissions)
    expect(list.ok && list.data.find((p) => p.id === promo.id)).toMatchObject({ studentCount: 3 })
  })

  test("an imported record takes the code whether it was imported before or after the code was created", async () => {
    const code = freshCode("I")
    const before = await leadWithCode(code, undefined, { imported: true })
    const promo = await newPromo(20000, code)
    expect(await promoHistory(promo.id)).toEqual([{ kind: "promo_created", student_count: 1, lead_ids: [before] }])
    const after = await leadWithCode(code, undefined, { imported: true })

    const admissions = await signedIn(ADMISSIONS)
    for (const leadId of [before, after]) {
      expect(await getLeadReferral(admissions, leadId)).toMatchObject({
        ok: true,
        data: { amount: 30000, amountOff: 20000, discountApplied: true, sentBeforeCode: false },
      })
    }
    const manager = await signedIn(MANAGER)
    const impact = await getPromoCodeImpact(manager, promo.id, { state: "paused" })
    expect(impact.ok && impact.data.map((family) => family.leadId).sort()).toEqual([before, after].sort())
    expect(await payInterview(before)).toBe(30000)
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
