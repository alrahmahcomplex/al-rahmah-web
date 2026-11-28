import type { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getInterviewDiscountRange } from "@/lib/services/referral"

import { anonClient, inOneSnapshot, inRolledBackTransaction, secretClient, signedIn, withoutLockWaits } from "../support/db"
import { freshCode } from "../support/discount-codes"
import { MANAGER } from "../support/fixtures"

// The range of savings on the public Admission form's price box (owner,
// 2026-11-28): the smallest and largest amount the codes working today take
// off, judged like the code check. Other files commit their own codes
// meanwhile, so each case reads in one snapshot and uses amounts no other
// test sets. Invented codes.

type Range = { lowest: number; highest: number }

async function range(sql: Client): Promise<Range> {
  return (await sql.query<Range>("select lowest, highest from public.interview_discount_range()")).rows[0]
}

/** A new Promo code, only inside the test's transaction. */
async function promo(sql: Client, amount: number, state = "active", endsOn: string | null = null) {
  const code = freshCode("R")
  await sql.query("select public.set_audit_actor('system')")
  await sql.query(
    `insert into public.promo_codes (code, name, amount, state, ends_on)
     values ($1, $2, $3, $4, $5::date)`,
    [code, `Range ${code}`, amount, state, endsOn],
  )
}

describe("which codes count", () => {
  test("an active Promo code counts; a paused, ended, expired or nothing-off one does not", async () => {
    const seen = await inOneSnapshot(async (sql) => {
      const before = await range(sql)
      await promo(sql, 49_997)
      const active = await range(sql)
      await promo(sql, 49_998, "paused")
      await promo(sql, 49_998, "ended")
      const { rows } = await sql.query<{ yesterday: string }>("select (public.tanzania_today() - 1)::text as yesterday")
      await promo(sql, 49_999, "active", rows[0].yesterday)
      const notCounted = await range(sql)
      await promo(sql, 0)
      return { before, active, notCounted, withZero: await range(sql) }
    })
    expect(seen.before.highest).toBeLessThan(49_997)
    expect(seen.active.highest).toBe(49_997)
    expect(seen.notCounted.highest).toBe(49_997)
    expect(seen.withZero.lowest).toBeGreaterThan(0)
  })

  test("an Approved agent's own amount counts until the agent is switched off", async () => {
    const seen = await inOneSnapshot(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        `select id from public.marketing_agents
         where status = 'Approved' and switched_off_at is null and retired_at is null
         order by id limit 1`,
      )
      if (!rows[0]) throw new Error("the seeds hold no Approved agent")
      // Triggers off for this transaction: only the stored amount and the
      // switch matter here, not the fees and audit rows they would write.
      await sql.query("set local session_replication_role = replica")
      await withoutLockWaits(sql, "update public.marketing_agents set interview_discount = 49996 where id = $1", [rows[0].id])
      const approved = await range(sql)
      await sql.query("update public.marketing_agents set switched_off_at = now() where id = $1", [rows[0].id])
      return { approved, off: await range(sql) }
    })
    expect(seen.approved.highest).toBe(49_996)
    expect(seen.off.highest).toBeLessThan(49_996)
  })

  test("the smallest saving is the lowest working amount", async () => {
    const lowest = await inOneSnapshot(async (sql) => {
      await promo(sql, 1)
      return (await range(sql)).lowest
    })
    expect(lowest).toBe(1)
  })
})

describe("who may read it", () => {
  test("the secret key reads two whole numbers, lowest first", async () => {
    const read = await getInterviewDiscountRange(secretClient())
    if (!read.ok) throw new Error(read.error)
    expect(Object.keys(read.data).sort()).toEqual(["highest", "lowest"])
    expect(read.data.lowest).toBeLessThanOrEqual(read.data.highest)
  })

  test("a visitor and signed-in staff may not call it", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    expect(await getInterviewDiscountRange(anonClient())).toEqual({ ok: false, error: "unavailable" })
    expect(await getInterviewDiscountRange(await signedIn(MANAGER))).toEqual({ ok: false, error: "unavailable" })
    const grants = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ role: string; granted: boolean }>(
        `select r.role, has_function_privilege(r.role, 'public.interview_discount_range()', 'execute') as granted
         from unnest(array['anon', 'authenticated', 'service_role']) r (role) order by r.role`,
      )
      return rows
    })
    expect(grants).toEqual([
      { role: "anon", granted: false },
      { role: "authenticated", granted: false },
      { role: "service_role", granted: true },
    ])
  })
})
