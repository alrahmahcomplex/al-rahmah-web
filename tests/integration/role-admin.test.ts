import { randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { anonClient, createThrowawayStaff, inRolledBackTransaction, lockExclusively, signedIn } from "../support/db"
import { ACCOUNTANT, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// The guardrailed role functions behind the Staff and roles screen, called
// the way the screen calls them: as the signed-in Super Admin, the only one
// who changes roles (#241), with the publishable key. Each test makes its
// own roles, so parallel tests never change the same one.

async function administrator(): Promise<{ person: typeof SUPER_ADMIN; client: SupabaseClient }> {
  return { person: SUPER_ADMIN, client: await signedIn(SUPER_ADMIN) }
}

const uniqueName = (prefix: string) => `${prefix} ${randomUUID().slice(0, 8)}`

async function newRole(client: SupabaseClient, name = uniqueName("Role")): Promise<{ id: string; name: string }> {
  const { data, error } = await client.rpc("create_role", { name })
  if (error) throw new Error(`Could not create ${name}: ${error.message}`)
  return { id: data.id, name }
}

async function roleId(name: string): Promise<string> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.roles where name = $1", [name]),
  )
  return rows[0].id
}

async function roleRow(id: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ name: string; permissions: string[]; retired: boolean }>(
      "select name, permissions, retired from public.roles where id = $1",
      [id],
    ),
  )
  return rows[0]
}

async function auditRows(rowId: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{
      action: string
      old_values: Record<string, unknown> | null
      new_values: Record<string, unknown>
      scope: string
      actor_kind: string
      actor_staff_id: string | null
    }>(
      `select action, old_values, new_values, scope, actor_kind, actor_staff_id
       from public.audit_log where table_name = 'roles' and row_id = $1 order by id`,
      [rowId],
    ),
  )
  return rows
}

// A refusal comes back as its code, with the names the message needs.
function expectRefusal(
  result: { error: { message: string; details: string | null } | null },
  code: string,
  details?: Record<string, unknown>,
) {
  expect(result.error?.message).toBe(code)
  if (details) expect(JSON.parse(result.error?.details ?? "{}")).toEqual(details)
}

describe("who may call the role functions", () => {
  const calls: [string, Record<string, unknown>][] = [
    ["create_role", { name: "Anonymous role" }],
    ["rename_role", { role_id: randomUUID(), name: "Anonymous role" }],
    ["set_role_permission", { role_id: randomUUID(), permission: "leads.view", granted: true }],
    ["retire_role", { role_id: randomUUID() }],
  ]
  for (const [fn, args] of calls) {
    test(`anonymous visitors cannot call ${fn}`, async () => {
      const { error } = await anonClient().rpc(fn, args)

      expect(error).not.toBeNull()
      expect(error?.message).not.toBe("not_found")
    })
  }

  test("forbidden: nobody but the Super Admin changes a role, the Admissions Manager included (#241)", async () => {
    const { client: superAdmin } = await administrator()
    const role = await newRole(superAdmin)

    for (const person of [ACCOUNTANT, MANAGER]) {
      const client = await signedIn(person)
      expectRefusal(await client.rpc("create_role", { name: uniqueName("Refused") }), "forbidden")
      expectRefusal(await client.rpc("rename_role", { role_id: role.id, name: "Changed" }), "forbidden")
      expectRefusal(
        await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: true }),
        "forbidden",
      )
      expectRefusal(await client.rpc("retire_role", { role_id: role.id }), "forbidden")
    }
    expect(await roleRow(role.id)).toEqual({ name: role.name, permissions: [], retired: false })
  })

  test("there are no direct write policies on roles, even for an administrator", async () => {
    const { client } = await administrator()
    const role = await newRole(client)
    const direct = uniqueName("Direct")

    await client.from("roles").update({ name: "Direct write", permissions: ["leads.view"] }).eq("id", role.id)
    await client.from("roles").insert({ name: direct })

    expect(await roleRow(role.id)).toEqual({ name: role.name, permissions: [], retired: false })
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query("select 1 from public.roles where name = $1", [direct]),
    )
    expect(rows).toEqual([])
  })
})

describe("create_role", () => {
  test("creates a role with a trimmed name and no permissions, with one audit row naming the caller", async () => {
    const { person: manager, client } = await administrator()
    const name = uniqueName("Front office")

    const { data, error } = await client.rpc("create_role", { name: `  ${name} ` })

    expect(error).toBeNull()
    expect(data).toEqual({ id: expect.any(String), role: name })
    expect(await roleRow(data.id)).toEqual({ name, permissions: [], retired: false })
    expect(await auditRows(data.id)).toEqual([
      {
        action: "insert",
        old_values: null,
        new_values: expect.objectContaining({ name, permissions: [], retired: false }),
        scope: "staff_admin",
        actor_kind: "staff",
        actor_staff_id: manager.id,
      },
    ])
  })

  test("role_name_required: a role needs a name", async () => {
    const { client } = await administrator()

    expectRefusal(await client.rpc("create_role", { name: "   " }), "role_name_required")
  })

  test("duplicate_role_name: names are unique ignoring case", async () => {
    const { client } = await administrator()

    expectRefusal(await client.rpc("create_role", { name: "admissions STAFF" }), "duplicate_role_name", {
      role: "admissions STAFF",
    })
  })
})

describe("rename_role", () => {
  test("renames a role, with one audit row showing the old and new name", async () => {
    const { person: manager, client } = await administrator()
    const role = await newRole(client)
    const renamed = uniqueName("Front desk")

    const { data, error } = await client.rpc("rename_role", { role_id: role.id, name: renamed })

    expect(error).toBeNull()
    expect(data).toEqual({ id: role.id, role: renamed })
    expect((await auditRows(role.id)).slice(1)).toEqual([
      {
        action: "update",
        old_values: { name: role.name },
        new_values: { name: renamed },
        scope: "staff_admin",
        actor_kind: "staff",
        actor_staff_id: manager.id,
      },
    ])
  })

  test("a role may change only the case of its own name", async () => {
    const { client } = await administrator()
    const role = await newRole(client)

    expect((await client.rpc("rename_role", { role_id: role.id, name: role.name.toUpperCase() })).error).toBeNull()
    expect((await roleRow(role.id)).name).toBe(role.name.toUpperCase())
  })

  test("duplicate_role_name and role_name_required", async () => {
    const { client } = await administrator()
    const role = await newRole(client)

    expectRefusal(await client.rpc("rename_role", { role_id: role.id, name: "accountant" }), "duplicate_role_name", {
      role: "accountant",
    })
    expectRefusal(await client.rpc("rename_role", { role_id: role.id, name: "" }), "role_name_required")
    expect((await roleRow(role.id)).name).toBe(role.name)
  })

  test("the Admissions Manager role is ordinary data: renaming it is refused only for a taken name", async () => {
    const { client } = await administrator()

    expectRefusal(
      await client.rpc("rename_role", { role_id: await roleId("Admissions Manager"), name: "Accountant" }),
      "duplicate_role_name",
      { role: "Accountant" },
    )
  })

  test("role_retired: a retired role is not renamed", async () => {
    const { client } = await administrator()

    expectRefusal(
      await client.rpc("rename_role", { role_id: await roleId("Receptionist"), name: "Front desk" }),
      "role_retired",
      { role: "Receptionist" },
    )
  })

  test("refuses an unknown role", async () => {
    const { client } = await administrator()

    expectRefusal(await client.rpc("rename_role", { role_id: randomUUID(), name: "Nobody" }), "not_found")
  })
})

describe("set_role_permission", () => {
  test("ticks and unticks a permission, each with one audit row showing the old and new sets", async () => {
    const { person: manager, client } = await administrator()
    const role = await newRole(client)

    const ticked = await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: true })
    await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.create", granted: true })
    await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: false })

    expect(ticked).toMatchObject({ error: null, data: { id: role.id, role: role.name } })
    expect((await roleRow(role.id)).permissions).toEqual(["leads.create"])
    const changes = (await auditRows(role.id)).slice(1)
    expect(changes.map((row) => [row.old_values, row.new_values])).toEqual([
      [{ permissions: [] }, { permissions: ["leads.view"] }],
      [{ permissions: ["leads.view"] }, { permissions: ["leads.create", "leads.view"] }],
      [{ permissions: ["leads.create", "leads.view"] }, { permissions: ["leads.create"] }],
    ])
    expect(changes.every((row) => row.actor_staff_id === manager.id && row.scope === "staff_admin")).toBe(true)
  })

  test("ticking a permission the role already has changes nothing and records nothing", async () => {
    const { client } = await administrator()
    const role = await newRole(client)
    await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: true })
    const before = (await auditRows(role.id)).length

    expect(
      (await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: true })).error,
    ).toBeNull()
    expect(await auditRows(role.id)).toHaveLength(before)
  })

  test("unknown_permission: only names from the permission list are accepted", async () => {
    const { client } = await administrator()
    const role = await newRole(client)

    expectRefusal(
      await client.rpc("set_role_permission", { role_id: role.id, permission: "everything", granted: true }),
      "unknown_permission",
    )
    expect((await roleRow(role.id)).permissions).toEqual([])
  })

  test("a missing granted value is refused instead of removing the permission", async () => {
    const { client } = await administrator()
    const role = await newRole(client)
    await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: true })

    expectRefusal(
      await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: null }),
      "granted_required",
    )
    expect((await roleRow(role.id)).permissions).toEqual(["leads.view"])
  })

  test("the Admissions Manager role takes permission changes like any other (#241)", async () => {
    const { client } = await administrator()
    const manager = await roleId("Admissions Manager")
    const before = (await roleRow(manager)).permissions

    // Ticking one it already holds goes through and changes nothing, so the
    // shared fixture is left as it was.
    expect((await client.rpc("set_role_permission", { role_id: manager, permission: "leads.view", granted: true })).error).toBeNull()
    expect((await roleRow(manager)).permissions).toEqual(before)
  })

  test("role_retired", async () => {
    const { client } = await administrator()

    expectRefusal(
      await client.rpc("set_role_permission", {
        role_id: await roleId("Receptionist"),
        permission: "leads.edit",
        granted: true,
      }),
      "role_retired",
      { role: "Receptionist" },
    )
  })

  test("a removed permission stops has_permission for the role's holders on their next request", async () => {
    const { client } = await administrator()
    const holder = await createThrowawayStaff(["leads.view"])
    const holderClient = await signedIn(holder)
    expect((await holderClient.rpc("has_permission", { permission: "leads.view" })).data).toBe(true)

    const { error } = await client.rpc("set_role_permission", {
      role_id: holder.roleId,
      permission: "leads.view",
      granted: false,
    })

    expect(error).toBeNull()
    expect((await holderClient.rpc("has_permission", { permission: "leads.view" })).data).toBe(false)
  })
})

describe("retire_role", () => {
  test("retires a role nobody active holds, with one audit row", async () => {
    const { person: manager, client } = await administrator()
    const role = await newRole(client)

    const { data, error } = await client.rpc("retire_role", { role_id: role.id })

    expect(error).toBeNull()
    expect(data).toEqual({ id: role.id, role: role.name })
    expect((await roleRow(role.id)).retired).toBe(true)
    expect((await auditRows(role.id)).slice(1)).toEqual([
      {
        action: "update",
        old_values: { retired: false },
        new_values: { retired: true },
        scope: "staff_admin",
        actor_kind: "staff",
        actor_staff_id: manager.id,
      },
    ])
  })

  test("role_has_active_holders: retirement is refused while active staff hold the role, naming them", async () => {
    const { client } = await administrator()
    const first = await createThrowawayStaff(["leads.view"])
    const second = await createThrowawayStaff(["leads.view"])
    await client.rpc("assign_staff_role", { staff_id: second.id, role_id: first.roleId })

    expectRefusal(await client.rpc("retire_role", { role_id: first.roleId }), "role_has_active_holders", {
      role: first.roleName,
      names: [first.name, second.name].sort(),
    })
    expect((await roleRow(first.roleId)).retired).toBe(false)
  })

  test("deactivated holders don't block retirement", async () => {
    const { client } = await administrator()
    const holder = await createThrowawayStaff(["leads.view"])
    await client.rpc("deactivate_staff_member", { staff_id: holder.id })

    expect((await client.rpc("retire_role", { role_id: holder.roleId })).error).toBeNull()
    expect((await roleRow(holder.roleId)).retired).toBe(true)
  })

  test("role_retired: a retired role is not retired again", async () => {
    const { client } = await administrator()
    const role = await newRole(client)
    await client.rpc("retire_role", { role_id: role.id })
    const before = (await auditRows(role.id)).length

    expectRefusal(await client.rpc("retire_role", { role_id: role.id }), "role_retired", { role: role.name })
    expect(await auditRows(role.id)).toHaveLength(before)
  })

  test("the Admissions Manager role is retired like any other, once nobody active holds it", async () => {
    const { client } = await administrator()

    expectRefusal(await client.rpc("retire_role", { role_id: await roleId("Admissions Manager") }), "role_has_active_holders")
  })
})

describe("no last-administrator guard on roles (#241)", () => {
  test("retiring every role but the Super Admin's goes through in SQL", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await lockExclusively(sql, ["public.staff_members", "public.roles"])

      await sql.query("update public.roles set retired = true where id <> $1", [SUPER_ADMIN.roleId])
    })
  })
})
