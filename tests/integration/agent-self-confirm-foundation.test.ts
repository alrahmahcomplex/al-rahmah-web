import { randomInt } from "node:crypto"

import type { Client } from "pg"
import { afterAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { sendSms, type SmsSender } from "@/lib/services/sms"

import { anonClient, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS } from "../support/fixtures"

// Agent self-confirm, slice 1 (#503): the switch, the owner's name rule and
// the SMS budget and limits. SQL as the database owner for the functions no
// API role may call; the secret key for reserve_sms, record_sms and sendSms.

async function owner<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

// The SMS rows this file commits, removed at the end so reruns on the same
// day never fill the budget.
const mobilesUsed: string[] = []
function mobile(): string {
  const m = `+2557${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
  mobilesUsed.push(m)
  return m
}
afterAll(async () => {
  const { Client: PgClient } = await import("pg")
  const sql = new PgClient({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("delete from public.sms_sends where to_phone = any($1)", [mobilesUsed])
  } finally {
    await sql.end()
  }
})

describe("the owner's name rule", () => {
  async function matches(onRecord: string, typed: string): Promise<boolean> {
    const [row] = await owner<{ m: boolean }>("select public.agent_names_match($1, $2) as m", [onRecord, typed])
    return row.m
  }

  test.each([
    // Up to 3 letters: exact.
    ["Ali Juma Omari", "Ali Juma Omari", true],
    ["Ali Juma Omari", "Aly Juma Omari", false],
    // 4-5 letters: one typo.
    ["Juma Ali Omari", "Jumaa Ali Omari", true],
    ["Juma Ali Omari", "Jomaa Ali Omari", false],
    ["Amina Ali Omari", "Amena Ali Omari", true],
    // Two typos on a five-letter name are one too many.
    ["Amina Ali Omari", "Emena Ali Omari", false],
    // A typed name longer than the record's counts its extra letters as typos.
    ["Amina Ali Omari", "Aminata Ali Omari", false],
    // 6-10 letters: two.
    ["Amina Khamis Bakari", "Amina Kamis Bakari", true],
    ["Amina Khamis Bakari", "Amina Kamiz Bakari", true],
    ["Amina Khamis Bakari", "Amina Kamiz Bakary", true],
    ["Amina Khamis Bakari", "Amina Kmiz Bakari", false],
    ["Mwanaisha Ali Omari", "Mwanaisa Ali Omari", true],
    ["Mwanakhamis Ali Omari", "Mwanakamiz Ali Omari", true],
    // 10 letters is still two; 11 or more, three.
    ["Abdulrazak Ali Omari", "Abdurazaak Ali Omari", true],
    ["Abdulrazak Ali Omari", "Abdurazaaq Ali Omari", false],
    ["Abdulrahman Juma Ali", "Abdurahmaan Juma Ali", true],
    ["Abdulrahman Juma Ali", "Abdurahmaaan Juma Ali", true],
    ["Abdulrahman Juma Ali", "Abdurahmaaann Juma Ali", false],
    // A swap of two neighbours is one typo.
    ["Amina Khamis Bakari", "Amina Khamsi Bakari", true],
    ["Juma Ali Omari", "Jmua Ali Omari", true],
    // Any order; case, dots, apostrophes and hyphens don't count.
    ["Amina Khamis Bakari", "bakari amina KHAMIS", true],
    ["Abdul-Rahman Juma Ali", "Abdulrahman Juma Ali", true],
    ["Amina O'Neil Bakari", "Amina Oneil Bakari", true],
    // Initials fail; every name on record must be there.
    ["Amina Khamis Bakari", "A. Khamis Bakari", false],
    ["Amina Khamis Bakari", "Amina Bakari", false],
    ["Amina Khamis Bakari", "Asha Khamis Bakari", false],
    // Each record name takes a different typed name: with three typed names,
    // the second Ali can't reuse the first.
    ["Ali Ali Omari", "Ali Omari", false],
    ["Ali Ali Omari", "Ali Juma Omari", false],
    ["Ali Ali Omari", "Ali Omari Ali", true],
    // Pairing tries every way: Juma takes the first typed name it fits
    // (Jumaa), which leaves Jumaa with Jumu, two typos off; only Juma-Jumu
    // with Jumaa-Jumaa pairs them all.
    ["Juma Jumaa", "Jumaa Jumu", true],
    // A record with two names ignores a third typed name.
    ["Amina Bakari", "Amina Khamis Bakari", true],
  ])("%s against %s: %s", async (onRecord, typed, expected) => {
    expect(await matches(onRecord, typed)).toBe(expected)
  })

  test("names longer than 40 letters, too many names and empty names never match", async () => {
    const long = "a".repeat(41)
    expect(await matches(`${long} Ali Omari`, `${long} Ali Omari`)).toBe(false)
    expect(await matches("Ali Omari", "Ali Omari A B C D E F G")).toBe(false)
    expect(await matches("Ali Omari", "")).toBe(false)
    expect(await matches("", "Ali Omari")).toBe(false)
  })

  test("no API role may call it", async () => {
    const { error } = await secretClient().rpc("agent_names_match", { on_record: "Ali Omari", typed: "Ali Omari" })
    expect(error).not.toBeNull()
  })
})

describe("the self-confirm switch", () => {
  async function state(sql: Client) {
    const { rows } = await sql.query<{ on: boolean; setting: boolean }>(
      "select public.agent_self_confirm_on() as on, (select self_confirm_enabled from public.agent_access_settings) as setting",
    )
    return rows[0]
  }

  test("is off from setup, and on only while agent access is on too", async () => {
    await inRolledBackTransaction(async (sql) => {
      expect((await state(sql)).setting).toBe(false)
      expect((await state(sql)).on).toBe(false)

      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_self_confirm(true)")
      await sql.query("select public.set_agent_access(false)")
      expect(await state(sql)).toEqual({ on: false, setting: true })

      await sql.query("select public.set_agent_access(true)")
      expect(await state(sql)).toEqual({ on: true, setting: true })
    })
  })

  test("needs a named actor, and no API role may change it", async () => {
    await expect(owner("select public.set_agent_self_confirm(true)")).rejects.toThrow(/not_permitted/)
    const { error } = await secretClient().rpc("set_agent_self_confirm", { enabled: true })
    expect(error).not.toBeNull()
  })
})

describe("the SMS budget and limits", () => {
  function sender(log: string[] = []): SmsSender {
    return async (to, message) => {
      log.push(`${to}: ${message}`)
      return { ok: true, data: { requestId: `req-${log.length}` } }
    }
  }

  async function sends(to: string) {
    return owner<{ kind: string; result: string; provider_request_id: string | null; error_code: string | null }>(
      "select kind, result, provider_request_id, error_code from public.sms_sends where to_phone = $1 order by created_at",
      [to],
    )
  }

  test("a send reserves its place, goes out without the +, and is recorded as sent", async () => {
    const to = mobile()
    const log: string[] = []
    const sent = await sendSms(secretClient(), sender(log), { kind: "self_confirm", to: `0${to.slice(4)}`, message: "Namba yako ni 482913" })
    expect(sent.ok).toBe(true)
    expect(log).toEqual([`${to.slice(1)}: Namba yako ni 482913`])
    expect(await sends(to)).toEqual([{ kind: "self_confirm", result: "sent", provider_request_id: "req-1", error_code: null }])
  })

  test("a failed send is recorded with its code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const to = mobile()
    const failing: SmsSender = async () => ({ ok: false, error: "beem_111" })
    const sent = await sendSms(secretClient(), failing, { kind: "reset", to, message: "x" })
    expect(sent).toEqual({ ok: false, error: { kind: "provider-error", code: "beem_111" } })
    expect(await sends(to)).toEqual([{ kind: "reset", result: "provider_error", provider_request_id: null, error_code: "beem_111" }])
  })

  test("a number that isn't a Tanzanian mobile is refused before anything is reserved", async () => {
    const log: string[] = []
    const sent = await sendSms(secretClient(), sender(log), { kind: "self_confirm", to: "0222 123 456", message: "x" })
    expect(sent).toEqual({ ok: false, error: { kind: "invalid" } })
    expect(log).toEqual([])
  })

  test("a mobile gets at most 3 confirmation numbers an hour, but the courtesy SMS still goes", async () => {
    const to = mobile()
    const log: string[] = []
    for (const kind of ["self_confirm", "reset", "self_confirm"] as const) {
      expect((await sendSms(secretClient(), sender(log), { kind, to, message: "x" })).ok).toBe(true)
    }
    expect(await sendSms(secretClient(), sender(log), { kind: "reset", to, message: "x" })).toEqual({
      ok: false,
      error: { kind: "mobile-limited" },
    })
    expect((await sendSms(secretClient(), sender(log), { kind: "courtesy", to, message: "x" })).ok).toBe(true)
    expect(log).toHaveLength(4)
    expect((await sends(to)).map((s) => s.result)).toEqual(["sent", "sent", "sent", "mobile_limited", "sent"])
  })

  test("a mobile gets at most 5 confirmation numbers a day, even spread over hours", async () => {
    // Rolled back each time. reserve_sms counts by the Tanzanian day at the
    // moment it runs, so a run that crosses midnight is run again.
    const tanzanianDay = "select (clock_timestamp() at time zone 'Africa/Dar_es_Salaam')::date::text as day"
    for (let attempt = 1; ; attempt += 1) {
      const { outcomes, sameDay } = await inRolledBackTransaction(async (sql) => {
        await sql.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
        const before = (await sql.query<{ day: string }>(tanzanianDay)).rows[0].day
        // Today's sends, all more than an hour old, so only the day's limit
        // can refuse: five for one mobile, four for another.
        const [full, room] = [mobile(), mobile()]
        for (const [to, count] of [[full, 5], [room, 4]] as const) {
          await sql.query(
            `insert into public.sms_sends (kind, to_phone, tz_day, result, created_at, finished_at)
             select 'self_confirm', $1, $3::date, 'sent', clock_timestamp() - interval '2 hours', clock_timestamp()
             from generate_series(1, $2)`,
            [to, count, before],
          )
        }
        const reserve = async (kind: string, to: string) =>
          (await sql.query<{ r: { outcome: string } }>("select public.reserve_sms($1, $2) as r", [kind, to])).rows[0].r.outcome
        const outcomes = [
          await reserve("self_confirm", full),
          await reserve("courtesy", full),
          await reserve("reset", room),
          await reserve("reset", room),
        ]
        const after = (await sql.query<{ day: string }>(tanzanianDay)).rows[0].day
        return { outcomes, sameDay: before === after }
      })
      if (!sameDay && attempt < 3) continue
      expect(outcomes).toEqual(["mobile_limited", "reserved", "reserved", "mobile_limited"])
      break
    }
  })

  test("reservations for one mobile at once never pass its limit", async () => {
    const to = mobile()
    for (let i = 0; i < 2; i += 1) expect((await sendSms(secretClient(), sender(), { kind: "self_confirm", to, message: "x" })).ok).toBe(true)
    const answers = await Promise.all(
      Array.from({ length: 4 }, () => secretClient().rpc("reserve_sms", { kind: "self_confirm", to_phone: to })),
    )
    const outcomes = answers.map((a) => (a.data as { outcome: string }).outcome)
    expect(outcomes.filter((o) => o === "reserved")).toHaveLength(1)
    expect(outcomes.filter((o) => o === "mobile_limited")).toHaveLength(3)
  })

  test("a message longer than one SMS is refused before anything is reserved", async () => {
    const to = mobile()
    const log: string[] = []
    expect(await sendSms(secretClient(), sender(log), { kind: "courtesy", to, message: "a".repeat(161) })).toEqual({
      ok: false,
      error: { kind: "invalid" },
    })
    expect(log).toEqual([])
    expect(await sends(to)).toEqual([])
  })

  test("a failed send still counts against the mobile's limit", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const to = mobile()
    const failing: SmsSender = async () => ({ ok: false, error: "timeout" })
    for (let i = 0; i < 3; i += 1) await sendSms(secretClient(), failing, { kind: "self_confirm", to, message: "x" })
    expect(await sendSms(secretClient(), sender(), { kind: "self_confirm", to, message: "x" })).toEqual({
      ok: false,
      error: { kind: "mobile-limited" },
    })
  })

  test("the day's budget, once spent, refuses every kind", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query(`select set_config('request.jwt.claims', '{"role":"service_role"}', true)`)
      const { rows } = await sql.query<{ spent: number }>(
        `select count(*)::int as spent from public.sms_sends
         where tz_day = (now() at time zone 'Africa/Dar_es_Salaam')::date and result in ('reserved', 'sent', 'provider_error')`,
      )
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.sms_settings set daily_budget = $1", [rows[0].spent + 1])

      const reserve = async (kind: string) =>
        (await sql.query<{ r: { outcome: string } }>("select public.reserve_sms($1, $2) as r", [kind, mobile()])).rows[0].r.outcome
      expect(await reserve("self_confirm")).toBe("reserved")
      expect(await reserve("self_confirm")).toBe("budget_reached")
      expect(await reserve("courtesy")).toBe("budget_reached")
    })
  })

  test("record_sms records a reservation once", async () => {
    const reserved = await secretClient().rpc("reserve_sms", { kind: "courtesy", to_phone: mobile() })
    const sendId = (reserved.data as { send_id: string }).send_id
    expect((await secretClient().rpc("record_sms", { send_id: sendId, result: "sent", provider_request_id: "r1" })).error).toBeNull()
    const again = await secretClient().rpc("record_sms", { send_id: sendId, result: "provider_error", error_code: "x" })
    expect(again.error?.message).toBe("not_found")
  })

  test("only the secret key may reserve or record, and nobody reads the log through the API", async () => {
    const staff = await signedIn(ADMISSIONS)
    for (const client of [anonClient(), staff]) {
      expect((await client.rpc("reserve_sms", { kind: "courtesy", to_phone: mobile() })).error).not.toBeNull()
      expect((await client.rpc("record_sms", { send_id: "00000000-0000-0000-0000-000000000000", result: "sent" })).error).not.toBeNull()
      const read = await client.from("sms_sends").select("id").limit(1)
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true)
      const settings = await client.from("sms_settings").select("id").limit(1)
      expect(settings.error !== null || (settings.data ?? []).length === 0).toBe(true)
    }
    expect((await secretClient().from("sms_sends").select("id").limit(1)).error).not.toBeNull()
  })
})
