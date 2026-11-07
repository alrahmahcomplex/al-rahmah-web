import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"

import type { SupabaseClient } from "@supabase/supabase-js"
import { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getStaffAdminHistory, getStaffAndRoles } from "@/lib/services/staff-admin"

import { asSystem, inRolledBackTransaction, signedIn } from "../support/db"
import { SUPER_ADMIN } from "../support/fixtures"

// reports.view implies leads.view (#244). Every path that writes a role's
// permissions keeps the pair together, and the implied change is part of the
// role change's one audit row: create_role, set_role_permission, and direct
// SQL. A check constraint backs the trigger.

const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`
const BOTH = ["leads.view", "reports.view"]

type AuditRow = { action: string; old_values: { permissions?: string[] } | null; new_values: { permissions?: string[] } }

async function superAdmin(): Promise<SupabaseClient> {
  return signedIn(SUPER_ADMIN)
}

async function newRole(client: SupabaseClient, permissions: string[] = []): Promise<string> {
  const { data, error } = await client.rpc("create_role", { name: unique("Pair"), permissions })
  if (error) throw new Error(`Could not create a role: ${error.message}`)
  return data.id
}

async function permissionsOf(id: string): Promise<string[]> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ permissions: string[] }>("select permissions from public.roles where id = $1", [id]),
  )
  return rows[0].permissions
}

async function auditRows(id: string): Promise<AuditRow[]> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<AuditRow>(
      `select action, old_values, new_values from public.audit_log
       where table_name = 'roles' and row_id = $1 order by id`,
      [id],
    ),
  )
  return rows
}

function permit(client: SupabaseClient, roleId: string, permission: string, granted: boolean) {
  return client.rpc("set_role_permission", { role_id: roleId, permission, granted })
}

// A statement on a fresh connection under `role`, rolled back. Answers
// "accepted" with the row it returned, or the error message.
async function directly(role: "service_role" | "postgres", statement: string, params: unknown[] = []) {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    if (role === "service_role") await sql.query("set local role service_role")
    await sql.query("select public.set_audit_actor('system')")
    const { rows } = await sql.query<{ permissions: string[] }>(statement, params)
    return { outcome: "accepted", permissions: rows[0]?.permissions ?? null }
  } catch (error) {
    return { outcome: (error as Error).message, permissions: null }
  } finally {
    await sql.query("rollback").catch(() => {})
    await sql.end()
  }
}

describe("create_role", () => {
  test("a role created with reports.view also gets leads.view, in its one creation audit row", async () => {
    const id = await newRole(await superAdmin(), ["reports.view"])

    expect(await permissionsOf(id)).toEqual(BOTH)
    const rows = await auditRows(id)
    expect(rows.map((row) => [row.action, row.new_values.permissions])).toEqual([["insert", BOTH]])
  })

  test("a role created with both keeps both, and one with leads.view alone stays as it is", async () => {
    const client = await superAdmin()
    expect(await permissionsOf(await newRole(client, BOTH))).toEqual(BOTH)
    expect(await permissionsOf(await newRole(client, ["leads.view"]))).toEqual(["leads.view"])
  })
})

describe("set_role_permission", () => {
  test("ticking reports.view also ticks leads.view, in one audit row", async () => {
    const client = await superAdmin()
    const id = await newRole(client, ["payments.view"])

    expect((await permit(client, id, "reports.view", true)).error).toBeNull()

    expect(await permissionsOf(id)).toEqual(["leads.view", "payments.view", "reports.view"])
    const changes = (await auditRows(id)).slice(1)
    expect(changes.map((row) => [row.old_values?.permissions, row.new_values.permissions])).toEqual([
      [["payments.view"], ["leads.view", "payments.view", "reports.view"]],
    ])
  })

  test("unticking leads.view also unticks reports.view, in one audit row", async () => {
    const client = await superAdmin()
    const id = await newRole(client, [...BOTH, "payments.view"])

    expect((await permit(client, id, "leads.view", false)).error).toBeNull()

    expect(await permissionsOf(id)).toEqual(["payments.view"])
    const changes = (await auditRows(id)).slice(1)
    expect(changes.map((row) => [row.old_values?.permissions, row.new_values.permissions])).toEqual([
      [["leads.view", "payments.view", "reports.view"], ["payments.view"]],
    ])
  })

  test("unticking reports.view leaves leads.view, and ticking leads.view adds nothing else", async () => {
    const client = await superAdmin()
    const id = await newRole(client, BOTH)

    await permit(client, id, "reports.view", false)
    expect(await permissionsOf(id)).toEqual(["leads.view"])

    const blank = await newRole(client)
    await permit(client, blank, "leads.view", true)
    expect(await permissionsOf(blank)).toEqual(["leads.view"])
  })

  test("the Staff and roles history shows the implied permission inside the role change", async () => {
    const client = await superAdmin()
    const id = await newRole(client)
    await permit(client, id, "reports.view", true)

    const overview = await getStaffAndRoles(client)
    if (!overview.ok) throw new Error("Staff and roles could not be read")
    const history = await getStaffAdminHistory(client, overview.data)
    if (!history.ok) throw new Error(history.error)
    const name = overview.data.roles.find((role) => role.id === id)!.name
    const change = history.data.find((entry) => entry.summary === `changed the role ${name}`)
    expect(change?.changes).toEqual([{ field: "permissions", from: "None", to: "View leads and their history, View reports" }])
  })
})

describe("direct SQL", () => {
  test("a signed-in staff member may not write roles at all, the Super Admin included", async () => {
    const client = await superAdmin()
    const id = await newRole(client, BOTH)

    const update = await client.from("roles").update({ permissions: ["reports.view"] }).eq("id", id).select()
    const insert = await client.from("roles").insert({ name: unique("Direct"), permissions: ["reports.view"] }).select()

    expect(update.error?.code).toBe("42501")
    expect(insert.error?.code).toBe("42501")
    expect(await permissionsOf(id)).toEqual(BOTH)
  })

  test("under the secret key, an insert with reports.view gains leads.view", async () => {
    expect(
      await directly("service_role", "insert into public.roles (name, permissions) values ($1, '{reports.view}') returning permissions", [
        unique("Direct"),
      ]),
    ).toEqual({ outcome: "accepted", permissions: BOTH })
  })

  test("under the secret key, an update keeps the pair together both ways", async () => {
    const id = await asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>("insert into public.roles (name, permissions) values ($1, '{payments.view}') returning id", [
        unique("Direct"),
      ])
      return rows[0].id
    })
    expect(
      await directly("service_role", "update public.roles set permissions = '{payments.view,reports.view}' where id = $1 returning permissions", [id]),
    ).toEqual({ outcome: "accepted", permissions: ["leads.view", "payments.view", "reports.view"] })

    await asSystem((sql) => sql.query("update public.roles set permissions = '{leads.view,reports.view}' where id = $1", [id]))
    expect(
      await directly("service_role", "update public.roles set permissions = '{reports.view}' where id = $1 returning permissions", [id]),
    ).toEqual({ outcome: "accepted", permissions: [] })
  })

  test("with the trigger switched off, the check constraint still refuses reports.view alone", async () => {
    const result = await directly(
      "postgres",
      `alter table public.roles disable trigger imply_role_permissions;
       insert into public.roles (name, permissions) values ('${unique("Unchecked")}', '{reports.view}') returning permissions`,
    )
    expect(result.outcome).toMatch(/roles_reports_view_needs_leads_view/)
  })
})

describe("the repair migration", () => {
  const migration = readFileSync("supabase/migrations/20261130990700_reports_imply_leads.sql", "utf8")
  const repair = /^update public\.roles\b[\s\S]*?;$/m.exec(migration)?.[0]

  test("leaves no role holding reports.view without leads.view", async () => {
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ count: number }>(
        "select count(*)::int as count from public.roles where 'reports.view' = any (permissions) and not ('leads.view' = any (permissions))",
      ),
    )
    expect(rows).toEqual([{ count: 0 }])
  })

  test("takes reports.view from a role holding it alone, and leaves every other role as it was", async () => {
    expect(repair).toBeDefined()
    const result = await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("alter table public.roles drop constraint roles_reports_view_needs_leads_view")
      await sql.query("alter table public.roles disable trigger imply_role_permissions")
      const broken = await sql.query<{ id: string }>(
        "insert into public.roles (name, permissions) values ($1, '{payments.view,reports.view}') returning id",
        [unique("Broken")],
      )
      const whole = await sql.query<{ id: string }>(
        "insert into public.roles (name, permissions) values ($1, '{leads.view,reports.view}') returning id",
        [unique("Whole")],
      )
      await sql.query("alter table public.roles enable trigger imply_role_permissions")
      await sql.query(repair!)
      const after = await sql.query<{ id: string; permissions: string[] }>(
        "select id, permissions from public.roles where id = any ($1)",
        [[broken.rows[0].id, whole.rows[0].id]],
      )
      const audited = await sql.query<{ count: number }>(
        "select count(*)::int as count from public.audit_log where table_name = 'roles' and row_id = $1 and action = 'update' and actor_kind = 'system'",
        [broken.rows[0].id],
      )
      return {
        broken: after.rows.find((row) => row.id === broken.rows[0].id)!.permissions,
        whole: after.rows.find((row) => row.id === whole.rows[0].id)!.permissions,
        audited: audited.rows[0].count,
      }
    })
    expect(result).toEqual({ broken: ["payments.view"], whole: BOTH, audited: 1 })
  })
})
