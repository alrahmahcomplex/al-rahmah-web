import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { describe, expect, test } from "vitest"

import { inRolledBackTransaction, signedIn } from "../support/db"
import { MANAGER, SUPER_ADMIN } from "../support/fixtures"

// The Roles page saves once (owner request of 2026-11-27): save_role_changes
// applies only the boxes that changed, all or nothing, and the rows one save
// writes share a transaction, so the History shows them as one entry.

const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`

type Changes = { add?: string[]; remove?: string[]; addManaged?: string[]; removeManaged?: string[] }

function save(client: SupabaseClient, roleId: string, changes: Changes) {
  return client.rpc("save_role_changes", {
    role_id: roleId,
    add_permissions: changes.add ?? [],
    remove_permissions: changes.remove ?? [],
    add_managed_role_ids: changes.addManaged ?? [],
    remove_managed_role_ids: changes.removeManaged ?? [],
  })
}

async function newRole(client: SupabaseClient, permissions: string[] = []): Promise<string> {
  const { data, error } = await client.rpc("create_role", { name: unique("Save once"), permissions })
  if (error) throw new Error(`Could not create a role: ${error.message}`)
  return data.id
}

async function stateOf(id: string): Promise<{ permissions: string[]; manages: string[] }> {
  return inRolledBackTransaction(async (sql) => {
    const role = await sql.query<{ permissions: string[] }>("select permissions from public.roles where id = $1", [id])
    const pairs = await sql.query<{ managed_role_id: string }>(
      "select managed_role_id from public.role_managed_roles where role_id = $1 and active order by managed_role_id",
      [id],
    )
    return { permissions: role.rows[0].permissions, manages: pairs.rows.map((row) => row.managed_role_id) }
  })
}

async function auditOf(ids: string[]): Promise<{ table_name: string; transaction_id: string | null }[]> {
  return inRolledBackTransaction(async (sql) => {
    const { rows } = await sql.query<{ table_name: string; transaction_id: string | null }>(
      `select table_name, transaction_id::text from public.audit_log
       where (table_name = 'roles' and row_id::text = any ($1::text[]))
          or (table_name = 'role_managed_roles' and new_values ->> 'role_id' = any ($1::text[]))
       order by id`,
      [ids],
    )
    return rows
  })
}

describe("save_role_changes", () => {
  test("adds and takes away permissions and managed roles in one call, written by one transaction", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const id = await newRole(client, ["leads.view", "results.send"])
    const [a, b] = [await newRole(client), await newRole(client)]
    const before = (await auditOf([id])).length

    const { data, error } = await save(client, id, { add: ["leads.decline"], remove: ["results.send"], addManaged: [a, b] })
    expect(error).toBeNull()
    expect(data).toMatchObject({ id })
    expect(await stateOf(id)).toEqual({ permissions: ["leads.decline", "leads.view"], manages: [a, b].sort() })

    const rows = (await auditOf([id])).slice(before)
    expect(rows.map((row) => row.table_name)).toEqual(["roles", "role_managed_roles", "role_managed_roles"])
    expect(new Set(rows.map((row) => row.transaction_id)).size).toBe(1)
    expect(rows[0].transaction_id).not.toBeNull()
  })

  test("keeps another save's changes to other boxes; on the same box the later save wins", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const id = await newRole(client, ["leads.view"])

    // Two Super Admin screens opened on the same saved role.
    expect((await save(client, id, { add: ["leads.decline"] })).error).toBeNull()
    expect((await save(client, id, { add: ["results.send"] })).error).toBeNull()
    expect((await stateOf(id)).permissions).toEqual(["leads.decline", "leads.view", "results.send"])

    expect((await save(client, id, { remove: ["leads.decline"] })).error).toBeNull()
    expect((await stateOf(id)).permissions).toEqual(["leads.view", "results.send"])
  })

  test("keeps the pairs together, as every other write does", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const id = await newRole(client)
    expect((await save(client, id, { add: ["visits.record", "reports.view"] })).error).toBeNull()
    expect((await stateOf(id)).permissions).toEqual(["leads.view", "payments.view", "reports.view", "visits.record"])

    expect((await save(client, id, { remove: ["payments.view", "leads.view"] })).error).toBeNull()
    expect((await stateOf(id)).permissions).toEqual([])
  })

  test("saves nothing when any change is refused", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const id = await newRole(client, ["leads.view"])
    const retired = await newRole(client)
    expect((await client.rpc("retire_role", { role_id: retired })).error).toBeNull()

    const refused = await save(client, id, { add: ["leads.decline"], addManaged: [retired] })
    expect(refused.error?.message).toBe("role_retired")
    expect(await stateOf(id)).toEqual({ permissions: ["leads.view"], manages: [] })

    expect((await save(client, id, { add: ["no.such_permission"] })).error?.message).toBe("unknown_permission")
    expect((await save(client, id, { add: ["audit.view"] })).error?.message).toBe("unknown_permission")
    expect((await save(client, id, { add: ["leads.decline"], remove: ["leads.decline"] })).error?.message).toBe("conflicting_changes")
    expect((await save(client, id, { addManaged: [id] })).error?.message).toBe("manages_itself")
    expect((await stateOf(id)).permissions).toEqual(["leads.view"])
  })

  test("takes a role out of a retired role's managed set, but changes no permission on it", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const id = await newRole(client)
    const managed = await newRole(client)
    expect((await save(client, id, { addManaged: [managed] })).error).toBeNull()
    expect((await client.rpc("retire_role", { role_id: id })).error).toBeNull()

    expect((await save(client, id, { add: ["leads.view"] })).error?.message).toBe("role_retired")
    expect((await save(client, id, { removeManaged: [managed] })).error).toBeNull()
    expect((await stateOf(id)).manages).toEqual([])
  })

  test("is the Super Admin's alone", async () => {
    const owner = await signedIn(SUPER_ADMIN)
    const id = await newRole(owner)
    const { error } = await save(await signedIn(MANAGER), id, { add: ["leads.view"] })
    expect(error?.message).toBe("forbidden")
    expect((await stateOf(id)).permissions).toEqual([])
  })
})
