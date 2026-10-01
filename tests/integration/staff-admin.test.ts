import { describe, expect, test } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"

import { Client } from "pg"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, RETIRED_ROLE } from "../support/fixtures"

// The guardrailed write functions behind the Staff and roles screen, called
// the way the screen calls them: as a signed-in staff member with the
// publishable key. Each test makes its own staff members so parallel tests
// never change the same person.

type Throwaway = Awaited<ReturnType<typeof createThrowawayStaff>>

async function administrator(): Promise<{ person: Throwaway; client: SupabaseClient }> {
  const person = await createThrowawayStaff(["staff.administer"])
  return { person, client: await signedIn(person) }
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

  test("not_permitted: a role without Administer staff and roles changes nobody", async () => {
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

  test("one administrator can move another administrator off the administering role", async () => {
    const { client } = await administrator()
    const { person: other } = await administrator()
    const admissions = await roleId("Admissions Staff")

    const { error } = await client.rpc("assign_staff_role", { staff_id: other.id, role_id: admissions })

    expect(error).toBeNull()
    expect((await staffRow(other.id)).role_id).toBe(admissions)
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

  test("one administrator can deactivate another", async () => {
    const { client } = await administrator()
    const { person: other, client: otherClient } = await administrator()

    const { error } = await client.rpc("deactivate_staff_member", { staff_id: other.id })

    expect(error).toBeNull()
    expect((await otherClient.rpc("has_permission", { permission: "staff.administer" })).data).toBe(false)
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

  test("an administrator may correct their own name", async () => {
    const { person, client } = await administrator()

    expect((await client.rpc("correct_staff_name", { staff_id: person.id, full_name: "Fixed Name" })).error).toBeNull()
    expect((await staffRow(person.id)).full_name).toBe("Fixed Name")
  })

  test("refuses an empty name", async () => {
    const { client } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    expectRefusal(await client.rpc("correct_staff_name", { staff_id: target.id, full_name: "   " }), "name_required")
    expect((await staffRow(target.id)).full_name).toBe(target.name)
  })
})

describe("no_administrator_left", () => {
  // Through the functions an administrator can never remove the last one,
  // because they cannot move or deactivate themselves. The rule also covers
  // the SQL editor and the secret key, where nothing else stops it.
  test("a write that leaves nobody able to administer staff is refused, for the database owner too", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      // Holds off concurrent tests adding administrators while this counts.
      await sql.query("lock table public.staff_members in exclusive mode")

      await expect(
        sql.query(`update public.staff_members s set active = false
                   from public.roles r
                   where r.id = s.role_id and s.active and 'staff.administer' = any (r.permissions)`),
      ).rejects.toThrow("no_administrator_left")
    })
  })

  test("removing an administrator while another remains is allowed", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("lock table public.staff_members in exclusive mode")
      const { rows } = await sql.query<{ id: string }>(
        `select s.id from public.staff_members s join public.roles r on r.id = s.role_id
         where s.active and 'staff.administer' = any (r.permissions) order by s.created_at`,
      )
      expect(rows.length).toBeGreaterThan(1)

      await sql.query("update public.staff_members set active = false where id = any ($1)", [
        rows.slice(1).map((row) => row.id),
      ])
    })
  })

  // Two removals that each leave an administrator behind must not count at
  // the same time, or both could pass and leave nobody. The second waits for
  // the first to finish. Both roll back, so the seeded administrators are
  // never actually removed while other tests run.
  test("a second administrator removal waits for the first to finish before counting", async () => {
    const [{ person: first }, { person: second }] = await Promise.all([administrator(), administrator()])
    const connect = async () => {
      const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
      await sql.connect()
      await sql.query("begin")
      await sql.query("select public.set_audit_actor('system')")
      return sql
    }
    const one = await connect()
    const two = await connect()
    try {
      await one.query("update public.staff_members set active = false where id = $1", [first.id])

      const { rows } = await two.query<{ pid: number }>("select pg_backend_pid() as pid")
      let secondDone = false
      const secondRemoval = two
        .query("update public.staff_members set active = false where id = $1", [second.id])
        .then(() => (secondDone = true))

      const waiting = async () => {
        const probe = await inRolledBackTransaction((sql) =>
          sql.query<{ waiting: boolean }>(
            "select exists (select 1 from pg_locks where pid = $1 and locktype = 'advisory' and not granted) as waiting",
            [rows[0].pid],
          ),
        )
        return probe.rows[0].waiting
      }
      await expect.poll(waiting).toBe(true)
      expect(secondDone).toBe(false)

      await one.query("rollback")
      await secondRemoval
      expect(secondDone).toBe(true)
    } finally {
      await one.query("rollback").catch(() => {})
      await two.query("rollback").catch(() => {})
      await one.end()
      await two.end()
    }
  })
})
