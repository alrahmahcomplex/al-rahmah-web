import { describe, expect, test } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import { Client } from "pg"

import { anonClient, asStaffActor, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"

// Sign-in notices (ADR 4): the changes to someone's own role or active state
// that another actor made since they last dismissed their notices. Read and
// dismissed the way the staff home does it, as the signed-in person with the
// publishable key. Each test makes its own staff members so parallel tests
// never change the same person.

type Throwaway = Awaited<ReturnType<typeof createThrowawayStaff>>

type NoticeRow = {
  id: number
  created_at: string
  actor_kind: string
  actor_name: string | null
  old_role: string | null
  new_role: string | null
  active: boolean | null
}

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

async function notices(client: SupabaseClient): Promise<NoticeRow[]> {
  const { data, error } = await client.rpc("my_notices")
  expect(error).toBeNull()
  return data as NoticeRow[]
}

async function staffRow(id: string) {
  const { rows } = await inRolledBackTransaction((sql) =>
    sql.query<{ full_name: string; role_id: string; active: boolean; notices_seen_at: Date }>(
      "select full_name, role_id, active, notices_seen_at from public.staff_members where id = $1",
      [id],
    ),
  )
  return rows[0]
}

async function ok(result: PromiseLike<{ error: unknown }>) {
  const { error } = await result
  expect(error).toBeNull()
}

describe("which audit rows count as notices", () => {
  test("another Manager changing someone's role gives them one notice naming the actor and both roles", async () => {
    const { person: manager, client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    await ok(managerClient.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Accountant") }))

    expect(await notices(await signedIn(target))).toEqual([
      expect.objectContaining({
        actor_kind: "staff",
        actor_name: manager.name,
        old_role: target.roleName,
        new_role: "Accountant",
        active: null,
      }),
    ])
  })

  test("a deactivation and a reactivation by someone else give a notice each, oldest first", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    await ok(managerClient.rpc("deactivate_staff_member", { staff_id: target.id }))
    await ok(managerClient.rpc("reactivate_staff_member", { staff_id: target.id }))

    const rows = await notices(await signedIn(target))
    expect(rows.map((row) => row.active)).toEqual([false, true])
    expect(rows.every((row) => row.old_role === null && row.new_role === null)).toBe(true)
  })

  test("a change made by the system, such as a migration, is a notice too", async () => {
    const target = await createThrowawayStaff(["leads.view"])
    const accountant = await roleId("Accountant")

    await asSystem((sql) => sql.query("update public.staff_members set role_id = $1 where id = $2", [accountant, target.id]))

    expect(await notices(await signedIn(target))).toEqual([
      expect.objectContaining({ actor_kind: "system", actor_name: null, new_role: "Accountant" }),
    ])
  })

  test("a change the person made to themselves is not a notice", async () => {
    const target = await createThrowawayStaff(["leads.view"])
    const accountant = await roleId("Accountant")

    // The screen refuses this (own_role), so it can only come from SQL
    // naming the person as the actor.
    await asStaffActor(target.id, (sql) =>
      sql.query("update public.staff_members set role_id = $1 where id = $2", [accountant, target.id]),
    )

    expect(await notices(await signedIn(target))).toEqual([])
  })

  test("a name correction by another Manager is not a notice", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])

    await ok(managerClient.rpc("correct_staff_name", { staff_id: target.id, full_name: `${target.name} Corrected` }))

    expect(await notices(await signedIn(target))).toEqual([])
  })

  test("changes to other staff members are not the caller's notices", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    const bystander = await createThrowawayStaff(["leads.view"])

    await ok(managerClient.rpc("deactivate_staff_member", { staff_id: target.id }))

    expect(await notices(await signedIn(bystander))).toEqual([])
  })

  test("anonymous visitors cannot read notices", async () => {
    const { error } = await anonClient().rpc("my_notices")

    expect(error).not.toBeNull()
  })
})

describe("dismiss_notices", () => {
  test("clears the notices, which stay cleared on the next sign-in, and a later change is a new notice", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await ok(managerClient.rpc("deactivate_staff_member", { staff_id: target.id }))
    await ok(managerClient.rpc("reactivate_staff_member", { staff_id: target.id }))
    const client = await signedIn(target)
    const shown = await notices(client)

    await ok(client.rpc("dismiss_notices", { through: shown.at(-1)!.id }))

    expect(await notices(client)).toEqual([])
    expect(await notices(await signedIn(target))).toEqual([])

    await ok(managerClient.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Accountant") }))
    expect(await notices(client)).toEqual([expect.objectContaining({ new_role: "Accountant" })])
  })

  test("keeps a notice that arrived after the one dismissed through, so nobody dismisses what they never saw", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await ok(managerClient.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Accountant") }))
    const client = await signedIn(target)
    const [seen] = await notices(client)

    await ok(managerClient.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Admissions Staff") }))
    await ok(client.rpc("dismiss_notices", { through: seen.id }))

    expect((await notices(client)).map((row) => row.new_role)).toEqual(["Admissions Staff"])
  })

  test("keeps a change that started before the notice dismissed through but committed after the dismissal", async () => {
    const { person: manager, client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    const accountant = await roleId("Accountant")

    // A slow write opens its transaction first...
    const slow = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await slow.connect()
    try {
      await slow.query("begin")
      await slow.query("select public.set_audit_actor('staff', $1)", [manager.id])

      // ...a quick one commits, and the person dismisses it...
      await ok(managerClient.rpc("assign_staff_role", { staff_id: target.id, role_id: accountant }))
      const client = await signedIn(target)
      const [seen] = await notices(client)
      await ok(client.rpc("dismiss_notices", { through: seen.id }))

      // ...then the slow one changes them and commits.
      await slow.query("update public.staff_members set active = false where id = $1", [target.id])
      await slow.query("update public.staff_members set active = true where id = $1", [target.id])
      await slow.query("commit")

      expect((await notices(client)).map((row) => row.active)).toEqual([false, true])
    } finally {
      await slow.query("rollback").catch(() => {})
      await slow.end()
    }
  })

  test("refuses to dismiss through an audit row that isn't a notice", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await ok(managerClient.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Accountant") }))
    await ok(managerClient.rpc("correct_staff_name", { staff_id: target.id, full_name: `${target.name} Corrected` }))
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ id: string }>(
        `select id from public.audit_log
         where table_name = 'staff_members' and row_id = $1 and new_values ? 'full_name' and action = 'update'`,
        [target.id],
      ),
    )
    const client = await signedIn(target)

    const { error } = await client.rpc("dismiss_notices", { through: Number(rows[0].id) })

    expect(error?.message).toBe("not_found")
    expect(await notices(client)).toEqual([expect.objectContaining({ new_role: "Accountant" })])
  })

  test("changes only notices_seen_at, and the audit row it writes is not a notice", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await ok(managerClient.rpc("assign_staff_role", { staff_id: target.id, role_id: await roleId("Accountant") }))
    const client = await signedIn(target)
    const [notice] = await notices(client)
    const before = await staffRow(target.id)

    await ok(client.rpc("dismiss_notices", { through: notice.id }))

    const after = await staffRow(target.id)
    expect(after).toMatchObject({ full_name: before.full_name, role_id: before.role_id, active: before.active })
    expect(after.notices_seen_at.getTime()).toBeGreaterThan(before.notices_seen_at.getTime())

    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ keys: string[]; actor_staff_id: string }>(
        `select array(select jsonb_object_keys(new_values)) as keys, actor_staff_id
         from public.audit_log where table_name = 'staff_members' and row_id = $1 order by id desc limit 1`,
        [target.id],
      ),
    )
    expect(rows).toEqual([{ keys: ["notices_seen_at"], actor_staff_id: target.id }])
    expect(await notices(client)).toEqual([])
  })

  test("refuses a notice that is not the caller's own, and changes nothing", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    const other = await createThrowawayStaff(["leads.view"])
    await ok(managerClient.rpc("deactivate_staff_member", { staff_id: target.id }))
    await ok(managerClient.rpc("reactivate_staff_member", { staff_id: target.id }))
    const [theirs] = await notices(await signedIn(target))
    const client = await signedIn(other)
    const before = await staffRow(other.id)

    const { error } = await client.rpc("dismiss_notices", { through: theirs.id })

    expect(error?.message).toBe("not_found")
    expect(await staffRow(other.id)).toEqual(before)
    expect(await notices(await signedIn(target))).toHaveLength(2)
  })

  test("takes no staff member or column to change: anything beyond the notice id is refused", async () => {
    const target = await createThrowawayStaff(["leads.view"])
    const other = await createThrowawayStaff(["leads.view"])
    const client = await signedIn(target)
    const before = await staffRow(other.id)

    for (const args of [
      { through: 1, staff_id: other.id },
      { through: 1, notices_seen_at: "2000-01-01T00:00:00Z" },
      { through: 1, active: false },
    ]) {
      const { error } = await client.rpc("dismiss_notices", args)
      expect(error).not.toBeNull()
    }
    expect(await staffRow(other.id)).toEqual(before)
  })

  test("anonymous visitors and the secret key without a session cannot dismiss", async () => {
    expect((await anonClient().rpc("dismiss_notices", { through: 1 })).error).not.toBeNull()
    expect((await secretClient().rpc("dismiss_notices", { through: 1 })).error).not.toBeNull()
  })

  test("a deactivated staff member with a working password cannot dismiss", async () => {
    const { client: managerClient } = await administrator()
    const target = await createThrowawayStaff(["leads.view"])
    await ok(managerClient.rpc("deactivate_staff_member", { staff_id: target.id }))
    const client = await signedIn(target)

    expect(await notices(client)).toEqual([])
    expect((await client.rpc("dismiss_notices", { through: 1 })).error?.message).toBe("not_staff")
  })
})
