import { randomUUID } from "node:crypto"

import { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getAgentAccess } from "@/lib/services/agent-access"
import { createAgent } from "@/lib/services/marketing-agents"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ADMISSIONS, MANAGER, SEEDED_AGENT } from "../support/fixtures"

// The agent access switch (#188) against local Supabase. The seeds turn it on
// as `system`; tests that turn it off or on do so in a rolled-back
// transaction, so other tests always see it on.

async function asUser<T>(sql: Client, userId: string, query: string, params: unknown[] = []): Promise<T[]> {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role: "authenticated" })])
  await sql.query("set local role authenticated")
  try {
    return (await sql.query(query, params)).rows as T[]
  } finally {
    await sql.query("reset role")
  }
}

async function userIdOf(sql: Client, staffId: string): Promise<string> {
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
  return rows[0].user_id
}

describe("the agent access switch", () => {
  test("a fresh database has it off since setup, and the agents seed turned it on as system", async () => {
    await inRolledBackTransaction(async (sql) => {
      const history = await sql.query<{ action: string; new_values: { enabled?: boolean }; actor_kind: string; scope: string }>(
        `select action, new_values, actor_kind, scope from public.audit_log
         where table_name = 'agent_access_settings' order by id limit 2`,
      )
      expect(history.rows).toEqual([
        { action: "insert", new_values: expect.objectContaining({ enabled: false, changed_at: null }), actor_kind: "system", scope: "staff_admin" },
        { action: "update", new_values: expect.objectContaining({ enabled: true }), actor_kind: "system", scope: "staff_admin" },
      ])
    })
  })

  test("staff who view agents read its state through the service", async () => {
    const access = await getAgentAccess(await signedIn(ADMISSIONS))
    expect(access).toEqual({ ok: true, data: { enabled: true, changedAt: expect.any(String), changedBy: { kind: "system" } } })
  })

  test("everyone else is refused the state", async () => {
    expect(await getAgentAccess(await signedIn(SEEDED_AGENT))).toEqual({ ok: false, error: "forbidden" })
    expect(await getAgentAccess(anonClient())).toEqual({ ok: false, error: "forbidden" })
    const noLeads = await createThrowawayStaff(["payments.view"])
    expect(await getAgentAccess(await signedIn(noLeads))).toEqual({ ok: false, error: "forbidden" })
  })

  test("switching names who did it, is audited in staff_admin, and can't be done through the API", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('staff', $1)", [MANAGER.id])
      await sql.query("select public.set_agent_access(false)")
      const state = await asUser<{ enabled: boolean; changed_by_kind: string; changed_by_name: string }>(
        sql,
        await userIdOf(sql, ADMISSIONS.id),
        "select enabled, changed_by_kind, changed_by_name from public.agent_access_status()",
      )
      expect(state).toEqual([{ enabled: false, changed_by_kind: "staff", changed_by_name: MANAGER.name }])

      const audit = await sql.query(
        `select scope, actor_kind, actor_staff_id from public.audit_log
         where table_name = 'agent_access_settings' order by id desc limit 1`,
      )
      expect(audit.rows).toEqual([{ scope: "staff_admin", actor_kind: "staff", actor_staff_id: MANAGER.id }])
    })

    // Neither staff nor the secret key's API role can switch it.
    const manager = await signedIn(MANAGER)
    expect((await manager.rpc("set_agent_access", { enabled: false })).error?.code).toMatch(/42501|PGRST202/)
    expect((await secretClient().rpc("set_agent_access", { enabled: false })).error?.code).toMatch(/42501|PGRST202/)
    expect((await manager.from("agent_access_settings").update({ enabled: false }).not("id", "is", null).select()).error?.code).toBe("42501")
  })

  test("it refuses a public-form or import actor, and a second settings row", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("savepoint s")
      await sql.query("select public.set_audit_actor('public_form')")
      await expect(sql.query("select public.set_agent_access(false)")).rejects.toThrow("not_permitted")
      await sql.query("rollback to savepoint s")
      await sql.query("select public.set_audit_actor('system')")
      await expect(sql.query("insert into public.agent_access_settings (enabled) values (true)")).rejects.toThrow()
    })
  })

  test("while it is off, an Approved agent gets no login", async () => {
    const address = `access-off-${randomUUID().slice(0, 8)}@example.test`
    const created = await createAgent(await signedIn(MANAGER), {
      fullName: `Access Off ${randomUUID().slice(0, 8)}`,
      phone: `07${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`,
      whatsapp: "",
      email: address,
      code: "",
    })
    expect(created.ok).toBe(true)
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      await expect(
        sql.query(
          `insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
             raw_app_meta_data, raw_user_meta_data, created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token)
           values ('00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated', $1, '', now(),
             '{}', '{}', now(), now(), '', '', '', '')`,
          [address],
        ),
      ).rejects.toThrow()
    })
  })

  test("it never changes a fee", async () => {
    // ADMSN-90431 carries the Approved seeded code BJN-402.
    await inRolledBackTransaction(async (sql) => {
      const admissions = await userIdOf(sql, ADMISSIONS.id)
      const amount = async () => ({
        rows: await asUser(sql, admissions, "select amount, discount_applied from public.expected_interview_amount('1ead0000-0000-4000-8000-000000000431')"),
      })
      const on = (await amount()).rows
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("select public.set_agent_access(false)")
      expect((await amount()).rows).toEqual(on)
      expect(on).toEqual([{ amount: 40000, discount_applied: true }])
    })
  })
})
