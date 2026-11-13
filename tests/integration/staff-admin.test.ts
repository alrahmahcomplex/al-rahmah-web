import { describe, expect, test } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn, withoutLockWaits } from "../support/db"
import { ACCOUNTANT, MANAGER, RETIRED_ROLE, SUPER_ADMIN } from "../support/fixtures"

// The guardrailed write functions behind the Staff and roles screen, called
// the way the screen calls them: as a signed-in staff member with the
// publishable key. Each test makes its own staff members so parallel tests
// never change the same person. The Super Admin manages every role's staff
// (#241), so they make these changes; tests/integration/roles-v2.test.ts
// covers the same writes scoped by a managed set.

async function administrator(): Promise<{ person: typeof SUPER_ADMIN; client: SupabaseClient }> {
  return { person: SUPER_ADMIN, client: await signedIn(SUPER_ADMIN) }
}

async function roleId(name: string): Promise<string> {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ id: string }>("select id from public.roles where name = $1", [name]),
  )
  return rows[0].id
}

async function staffRow(id: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ full_name: string; role_id: string; active: boolean }>(
      "select full_name, role_id, active from public.staff_members where id = $1",
      [id],
    ),
  )
  return rows[0]
}

async function auditRows(rowId: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{
      action: string
      old_values: Record<string, unknown>
      new_values: Record<string, unknown>
      scope: string
      actor_kind: string
      actor_staff_id: string | null
    }>(
      `select action, old_values, new_values, scope, actor_kind, actor_staff_id
       from public.audit_log where table_name = 'staff_members' and row_id = $1 order by id`,
      [rowId],
    ),
  )
  return rows
}

// A refusal comes back as its code, with the names the message needs.
function expectRefusal(
  result: { error: { message: string; details: string | null } | null },
  code: string,
  details?: Record<string, string>,
) {
  expect(result.error?.message).toBe(code)
  if (details) expect(JSON.parse(result.error?.details ?? "{}")).toEqual(details)
}

describe("who may call the write functions", () => {
  for (const fn of ["assign_staff_role", "deactivate_staff_member", "reactivate_staff_member", "correct_staff_name"]) {
    test(`anonymous visitors cannot call ${fn}`, async () => {
      const { error } = await anonClient().rpc(fn, { staff_id: RETIRED_ROLE.id })

      expect(error).not.toBeNull()
    })
  }

  test("not_permitted: a role that manages no staff changes nobody", async () => {
    const target = await createThrowawayStaff(["leads.view"])
    const client = await signedIn(ACCOUNTANT)

    expectRefusal(await client.rpc("deactivate_staff_member", { staff_id: target.id }), "not_permitted", {
      role: "Accountant",
    })
    expectRefusal(
      await client.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Accountant") }),
      "not_permitted",
    )
    expectRefusal(await client.rpc("correct_staff_name", { staff_id: target.id, full_name: "Changed" }), "not_permitted")
    expect(await staffRow(target.id)).toMatchObject({ active: true, full_name: target.name })
  })

  test("there are no direct write policies on staff members, even for an administrator", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    await client.from("staff_members").update({ full_name: "Direct write" }).eq("id", target.id)
    await client.from("staff_members").insert({ full_name: "Direct insert", email: "direct@example.test", role_id: target.roleId })

    expect((await staffRow(target.id)).full_name).toBe(target.name)
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query("select 1 from public.staff_members where email = 'direct@example.test'"),
    )
    expect(rows).toEqual([])
  })
})

describe("assign_staff_role", () => {
  test("moves another staff member and writes one audit row naming the caller", async () => {
    const { person: manager, client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    const accountant = await roleId("Accountant")
    const before = (await auditRows(target.id)).length

    const { data, error } = await client.rpc("assign_staff_role", { staff_id: target.id, role_id: accountant })

    expect(error).toBeNull()
    // The names as they stand after the change, for the screen's confirmation.
    expect(data).toEqual({ name: target.name, role: "Accountant" })
    expect((await staffRow(target.id)).role_id).toBe(accountant)
    expect((await auditRows(target.id)).slice(before)).toEqual([
      {
        action: "update",
        old_values: { role_id: target.roleId },
        new_values: { role_id: accountant },
        scope: "staff_admin",
        actor_kind: "staff",
        actor_staff_id: manager.id,
      },
    ])
  })

  test("own_role: nobody changes their own role", async () => {
    const { person, client } = await administrator()

    expectRefusal(
      await client.rpc("assign_staff_role", { staff_id: person.id, role_id: await roleId("Accountant") }),
      "own_role",
    )
    expect((await staffRow(person.id)).role_id).toBe(person.roleId)
  })

  test("role_retired: nobody is given a retired role", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    expectRefusal(
      await client.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Receptionist") }),
      "role_retired",
      { role: "Receptionist" },
    )
    expect((await staffRow(target.id)).role_id).toBe(target.roleId)
  })

  test("same_role: moving someone to the role they hold is refused", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    const before = (await auditRows(target.id)).length

    expectRefusal(
      await client.rpc("assign_staff_role", { staff_id: target.id, role_id: target.roleId }),
      "same_role",
      { name: target.name, role: target.roleName },
    )
    expect(await auditRows(target.id)).toHaveLength(before)
  })

  test("refuses an unknown staff member or role", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    const unknown = "00000000-0000-4000-8000-000000000000"

    expectRefusal(await client.rpc("assign_staff_role", { staff_id: unknown, role_id: target.roleId }), "not_found")
    expectRefusal(await client.rpc("assign_staff_role", { staff_id: target.id, role_id: unknown }), "not_found")
  })
})

describe("deactivate_staff_member", () => {
  test("deactivates another staff member and writes one audit row naming the caller", async () => {
    const { person: manager, client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    const before = (await auditRows(target.id)).length

    const { error } = await client.rpc("deactivate_staff_member", { staff_id: target.id })

    expect(error).toBeNull()
    expect((await staffRow(target.id)).active).toBe(false)
    expect((await auditRows(target.id)).slice(before)).toEqual([{
      action: "update",
      old_values: { active: true },
      new_values: { active: false },
      scope: "staff_admin",
      actor_kind: "staff",
      actor_staff_id: manager.id,
    }])
  })

  test("own_account: nobody deactivates themselves", async () => {
    const { person, client } = await administrator()

    expectRefusal(await client.rpc("deactivate_staff_member", { staff_id: person.id }), "own_account")
    expect((await staffRow(person.id)).active).toBe(true)
  })

  test("already_deactivated: deactivating twice is refused", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await client.rpc("deactivate_staff_member", { staff_id: target.id })
    const before = (await auditRows(target.id)).length

    expectRefusal(await client.rpc("deactivate_staff_member", { staff_id: target.id }), "already_deactivated", {
      name: target.name,
    })
    expect(await auditRows(target.id)).toHaveLength(before)
  })
})

describe("reactivate_staff_member", () => {
  test("reactivates a deactivated staff member", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await client.rpc("deactivate_staff_member", { staff_id: target.id })

    const { error } = await client.rpc("reactivate_staff_member", { staff_id: target.id })

    expect(error).toBeNull()
    expect((await staffRow(target.id)).active).toBe(true)
    expect((await auditRows(target.id)).at(-1)).toMatchObject({
      old_values: { active: false },
      new_values: { active: true },
    })
  })

  test("already_active: reactivating an active staff member is refused", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    expectRefusal(await client.rpc("reactivate_staff_member", { staff_id: target.id }), "already_active", {
      name: target.name,
    })
  })

  test("retired_role_on_reactivate: someone on a retired role is given a current role first, then reactivated", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await asSystem(async (sql) => {
      await sql.query("update public.staff_members set active = false where id = $1", [target.id])
      await sql.query("update public.roles set retired = true where id = $1", [target.roleId])
    })

    expectRefusal(
      await client.rpc("reactivate_staff_member", { staff_id: target.id }),
      "retired_role_on_reactivate",
      { name: target.name, role: target.roleName },
    )
    expect((await staffRow(target.id)).active).toBe(false)

    const admissions = await roleId("Admissions Staff")
    expect((await client.rpc("assign_staff_role", { staff_id: target.id, role_id: admissions })).error).toBeNull()
    expect((await client.rpc("reactivate_staff_member", { staff_id: target.id })).error).toBeNull()
    expect(await staffRow(target.id)).toMatchObject({ role_id: admissions, active: true })
  })
})

describe("correct_staff_name", () => {
  test("corrects a name, trimmed, with one audit row", async () => {
    const { person: manager, client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    const { data, error } = await client.rpc("correct_staff_name", {
      staff_id: target.id,
      full_name: "  Zawadi Mrisho ",
    })

    expect(error).toBeNull()
    expect(data).toEqual({ name: "Zawadi Mrisho", role: target.roleName })
    expect((await staffRow(target.id)).full_name).toBe("Zawadi Mrisho")
    expect((await auditRows(target.id)).at(-1)).toMatchObject({
      old_values: { full_name: target.name },
      new_values: { full_name: "Zawadi Mrisho" },
      actor_staff_id: manager.id,
    })
  })

  test("a Manager's own name is corrected by whoever manages their role, not by themselves", async () => {
    const client = await signedIn(MANAGER)

    expectRefusal(await client.rpc("correct_staff_name", { staff_id: MANAGER.id, full_name: "Fixed Name" }), "forbidden")
    expect((await staffRow(MANAGER.id)).full_name).toBe(MANAGER.name)
  })

  test("refuses an empty name", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    expectRefusal(await client.rpc("correct_staff_name", { staff_id: target.id, full_name: "   " }), "name_required")
    expect((await staffRow(target.id)).full_name).toBe(target.name)
  })
})

describe("no last-administrator guard (#241)", () => {
  // refuse_no_administrator_left is gone: the Super Admin always remains, so
  // every other staff member may be deactivated, through SQL as well.
  test("deactivating every staff member but the Super Admin goes through", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // It writes every staff row, so it never waits on one another test
      // holds while it holds the rest.
      await withoutLockWaits(sql, "update public.staff_members set active = false where active and id <> $1", [SUPER_ADMIN.id])
      const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from public.staff_members where active")
      expect(rows[0].n).toBe(1)
    })
  })
})
