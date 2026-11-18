import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { SUPER_ADMIN } from "../support/fixtures"

// visits.record implies payments.view (#460). Whoever can check in or
// register a student also sees school-fee payments. Every path that writes a
// role's permissions keeps the pair together, a check constraint backs the
// trigger, and no role is left holding visits.record without payments.view.
// The repair's one-off replay ran on the branch as migration-day evidence
// (PR #477); it alters the table, so it stays out of the suite.

const BOTH = ["payments.view", "visits.record"]
const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`

type AuditRow = { action: string; actor_kind: string; old_values: { permissions?: string[] } | null; new_values: { permissions?: string[] } }

async function newRole(client: SupabaseClient, permissions: string[] = []): Promise<string> {
  const { data, error } = await client.rpc("create_role", { name: unique("Check-in pair"), permissions })
  if (error) throw new Error(`Could not create a role: ${error.message}`)
  return data.id
}

async function permissionsOf(id: string): Promise<string[]> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ permissions: string[] }>("select permissions from public.roles where id = $1", [id]),
  )
  return rows[0].permissions
}

async function auditRows(sql: Client, id: string): Promise<AuditRow[]> {
  const { rows } = await sql.query<AuditRow>(
    `select action, actor_kind, old_values, new_values from public.audit_log
     where table_name = 'roles' and row_id = $1 order by id`,
    [id],
  )
  return rows
}

function permit(client: SupabaseClient, roleId: string, permission: string, granted: boolean) {
  return client.rpc("set_role_permission", { role_id: roleId, permission, granted })
}

// Runs `work` on a fresh connection as postgres, rolled back.
async function rolledBackAsPostgres<T>(work: (sql: Client) => Promise<T>): Promise<T> {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    await sql.query("select public.set_audit_actor('system')")
    return await work(sql)
  } finally {
    await sql.query("rollback").catch(() => {})
    await sql.end()
  }
}

describe("create_role and set_role_permission", () => {
  test("a role created with visits.record also gets payments.view, in its one creation audit row", async () => {
    const id = await newRole(await signedIn(SUPER_ADMIN), ["leads.view", "visits.record"])

    expect(await permissionsOf(id)).toEqual(["leads.view", ...BOTH])
    const rows = await inRolledBackTransaction((sql) => auditRows(sql, id))
    expect(rows.map((row) => [row.action, row.new_values.permissions])).toEqual([["insert", ["leads.view", ...BOTH]]])
  })

  test("ticking visits.record also ticks payments.view; unticking payments.view also unticks visits.record", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const id = await newRole(client, ["leads.view"])

    expect((await permit(client, id, "visits.record", true)).error).toBeNull()
    expect(await permissionsOf(id)).toEqual(["leads.view", ...BOTH])

    expect((await permit(client, id, "payments.view", false)).error).toBeNull()
    expect(await permissionsOf(id)).toEqual(["leads.view"])
  })

  test("unticking visits.record leaves payments.view, and payments.view alone adds nothing", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const id = await newRole(client, BOTH)

    expect((await permit(client, id, "visits.record", false)).error).toBeNull()
    expect(await permissionsOf(id)).toEqual(["payments.view"])
    expect(await permissionsOf(await newRole(client, ["payments.view"]))).toEqual(["payments.view"])
  })
})

describe("direct SQL", () => {
  test("an insert with visits.record gains payments.view, and an update that drops payments.view drops visits.record", async () => {
    const id = await asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.roles (name, permissions) values ($1, '{visits.record}') returning id",
        [unique("Direct")],
      )
      return rows[0].id
    })
    expect(await permissionsOf(id)).toEqual(BOTH)

    await asSystem((sql) => sql.query("update public.roles set permissions = '{visits.record}' where id = $1", [id]))
    expect(await permissionsOf(id)).toEqual([])
  })

  test("with the trigger switched off, the check constraint still refuses visits.record alone", async () => {
    // Replica mode skips the table's triggers for this transaction only.
    const outcome = await rolledBackAsPostgres(async (sql) => {
      await sql.query("set local session_replication_role = replica")
      return sql
        .query("insert into public.roles (name, permissions) values ($1, '{visits.record}')", [unique("Unchecked")])
        .then(
          () => "accepted",
          (error: Error) => error.message,
        )
    })
    expect(outcome).toMatch(/roles_visits_record_needs_payments_view/)
  })
})

describe("the repair", () => {
  test("leaves no role holding visits.record without payments.view", async () => {
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ count: number }>(
        "select count(*)::int as count from public.roles where 'visits.record' = any (permissions) and not ('payments.view' = any (permissions))",
      ),
    )
    expect(rows).toEqual([{ count: 0 }])
  })
})
