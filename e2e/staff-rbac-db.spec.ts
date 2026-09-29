import { randomUUID } from "node:crypto"

import { expect, test } from "@playwright/test"

import { PERMISSIONS } from "@/lib/permissions"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  secretClient,
  signedIn,
} from "./db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER, RETIRED_ROLE, type FixtureStaff } from "./fixtures"

// What staff, roles and the audit log allow, tested through the same doors a
// user, a server or an operator would use. See e2e/db.ts.

const SLICE_ONE_TABLES = [
  "permissions",
  "roles",
  "staff_members",
  "audit_log",
  "audit_scopes",
  "audit_action_kinds",
] as const

// The starting roles' grants, from the table in CONTEXT.md.
const STARTING_GRANTS: Record<string, string[]> = {
  "Admissions Staff": [
    "follow_ups.record",
    "interviews.record",
    "leads.close",
    "leads.create",
    "leads.decline",
    "leads.edit",
    "leads.view",
    "payments.view",
    "results.send",
    "visits.record",
  ],
  "Admissions Manager": [
    "academic_years.manage",
    "agents.approve",
    "discounts.approve",
    "follow_ups.record",
    "interviews.record",
    "leads.close",
    "leads.create",
    "leads.decline",
    "leads.edit",
    "leads.view",
    "lifecycle.intervene",
    "payments.view",
    "reopenings.approve",
    "results.send",
    "staff.administer",
    "visits.record",
  ],
  Accountant: ["interview_payments.record", "leads.view", "payments.record", "payments.view"],
}

// A lead from supabase/seed.sql. audit_log.lead_id references leads, so a lead id
// in the log must name one that exists.
const SEEDED_LEAD_ID = "1ead0000-0000-4000-8000-000000000001"

async function hasPermission(person: FixtureStaff, permission: string) {
  const { data, error } = await (await signedIn(person)).rpc("has_permission", { permission })
  expect(error).toBeNull()
  return data
}

test.describe("permissions and roles", () => {
  for (const table of SLICE_ONE_TABLES) {
    test(`anonymous visitors read nothing from ${table}`, async () => {
      const { data, error } = await anonClient().from(table).select("*")

      expect(error).toBeNull()
      expect(data).toEqual([])
    })
  }

  for (const fn of ["has_permission", "current_staff_member", "record_action", "set_audit_actor"]) {
    test(`anonymous visitors cannot call ${fn}`, async () => {
      const args =
        fn === "has_permission"
          ? { permission: "leads.view" }
          : fn === "record_action"
            ? { kind: "invite_sent" }
            : fn === "set_audit_actor"
              ? { kind: "system" }
              : {}

      const { error } = await anonClient().rpc(fn, args)

      expect(error).not.toBeNull()
    })
  }

  test("the database holds the same 18 permissions as the app, each with a label", async () => {
    const { data } = await (await signedIn(ADMISSIONS))
      .from("permissions")
      .select("name, label")
      .order("position")

    expect(data?.map((p) => p.name)).toEqual([...PERMISSIONS])
    expect(data?.find((p) => p.name === "staff.administer")?.label).toBe("Administer staff and roles")
    for (const permission of data ?? []) expect(permission.label).not.toBe("")
  })

  test("the three starting roles hold the grants in CONTEXT.md", async () => {
    const { data } = await (await signedIn(ACCOUNTANT))
      .from("roles")
      .select("name, permissions")
      .in("name", Object.keys(STARTING_GRANTS))

    expect(Object.fromEntries((data ?? []).map((role) => [role.name, role.permissions]))).toEqual(STARTING_GRANTS)
  })

  test("a role refuses a permission name that is not on the list", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")

      await expect(
        sql.query("insert into public.roles (name, permissions) values ('Bad', array['leads.delete'])"),
      ).rejects.toThrow("unknown_permission")
    })
  })

  const cases: [FixtureStaff, string, boolean][] = [
    [MANAGER, "staff.administer", true],
    [MANAGER, "payments.record", false],
    [ADMISSIONS, "leads.create", true],
    [ADMISSIONS, "staff.administer", false],
    [ACCOUNTANT, "payments.record", true],
    [ACCOUNTANT, "leads.edit", false],
    [DEACTIVATED, "leads.view", false],
    [RETIRED_ROLE, "leads.view", false],
  ]
  for (const [person, permission, expected] of cases) {
    test(`has_permission('${permission}') is ${expected} for ${person.name}`, async () => {
      expect(await hasPermission(person, permission)).toBe(expected)
    })
  }

  test("has_permission is false for an unknown permission name", async () => {
    expect(await hasPermission(MANAGER, "leads.delete")).toBe(false)
  })

  test("current_staff_member returns the signed-in person's record and permissions", async () => {
    const { data } = await (await signedIn(ACCOUNTANT)).rpc("current_staff_member").single()

    expect(data).toEqual({
      id: ACCOUNTANT.id,
      full_name: ACCOUNTANT.name,
      email: ACCOUNTANT.email,
      active: true,
      role_name: "Accountant",
      permissions: STARTING_GRANTS.Accountant,
    })
  })

  test("current_staff_member reports a deactivated person as inactive, with no permissions", async () => {
    const { data } = await (await signedIn(RETIRED_ROLE)).rpc("current_staff_member").single()

    expect(data).toMatchObject({ id: RETIRED_ROLE.id, active: false, role_name: "Receptionist", permissions: [] })
  })

  test("a deactivated staff member reads no roles and not even their own record", async () => {
    const client = await signedIn(DEACTIVATED)

    expect((await client.from("roles").select("id")).data).toEqual([])
    expect((await client.from("staff_members").select("id")).data).toEqual([])
  })

  test("staff without Administer staff and roles read only their own staff record", async () => {
    const { data } = await (await signedIn(ADMISSIONS)).from("staff_members").select("id")

    expect(data).toEqual([{ id: ADMISSIONS.id }])
  })

  test("administrators read every staff record, deactivated ones included", async () => {
    const { data } = await (await signedIn(MANAGER)).from("staff_members").select("id")
    const ids = data?.map((row) => row.id) ?? []

    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT, DEACTIVATED, RETIRED_ROLE]) {
      expect(ids).toContain(person.id)
    }
  })

  test("has_permission turns false on the next request after deactivation", async () => {
    const person = await createThrowawayStaff(["leads.view"])
    const client = await signedIn(person)
    expect((await client.rpc("has_permission", { permission: "leads.view" })).data).toBe(true)

    await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [person.id]))

    expect((await client.rpc("has_permission", { permission: "leads.view" })).data).toBe(false)
  })

  test("has_permission follows a change to the role's permissions on the next request", async () => {
    const person = await createThrowawayStaff(["leads.view"])
    const client = await signedIn(person)
    expect((await client.rpc("has_permission", { permission: "payments.view" })).data).toBe(false)

    await asSystem((sql) =>
      sql.query("update public.roles set permissions = array['payments.view'] where id = $1", [person.roleId]),
    )

    expect((await client.rpc("has_permission", { permission: "payments.view" })).data).toBe(true)
    expect((await client.rpc("has_permission", { permission: "leads.view" })).data).toBe(false)
  })
})

test.describe("accounts", () => {
  test("public sign-up is refused", async () => {
    const { data, error } = await anonClient().auth.signUp({
      email: "stranger@example.test",
      password: "fixture-password",
    })

    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })

  test("no account can be created for an email with no staff record, even with the secret key", async () => {
    const { data, error } = await secretClient().auth.admin.createUser({
      email: `stranger-${randomUUID().slice(0, 8)}@example.test`,
      password: "fixture-password",
      email_confirm: true,
    })

    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
  })

  test("no account can be created for a deactivated staff member", async () => {
    const email = `withdrawn-${randomUUID().slice(0, 8)}@example.test`
    await asSystem((sql) =>
      sql.query(
        `insert into public.staff_members (full_name, email, role_id, active)
         select 'Withdrawn invite', $1, id, false from public.roles where name = 'Admissions Staff'`,
        [email],
      ),
    )

    const { error } = await secretClient().auth.admin.createUser({ email, password: "fixture-password" })

    expect(error).not.toBeNull()
  })

  test("a new account for an active staff member is linked to their record", async () => {
    const email = `new-hire-${randomUUID().slice(0, 8)}@example.test`
    await asSystem((sql) =>
      sql.query(
        `insert into public.staff_members (full_name, email, role_id)
         select 'New Hire', $1, id from public.roles where name = 'Accountant'`,
        [email],
      ),
    )

    const { data, error } = await secretClient().auth.admin.createUser({
      email,
      password: "fixture-password",
      email_confirm: true,
    })
    expect(error).toBeNull()

    const staff = await (await signedIn({ email, password: "fixture-password" })).rpc("current_staff_member").single()
    expect(staff.data).toMatchObject({ email, active: true, role_name: "Accountant" })

    const linked = await inRolledBackTransaction((sql) =>
      sql.query("select user_id from public.staff_members where email = $1", [email]),
    )
    expect(linked.rows[0].user_id).toBe(data.user?.id)
  })

  test("the allowlist, is_admin() and the old sign-up trigger are gone", async () => {
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query(`select
        to_regclass('public.allowed_admin_emails') as allowlist,
        to_regprocedure('public.is_admin()') as is_admin,
        (select count(*)::int from pg_trigger where tgname = 'enforce_staff_allowlist') as old_trigger`),
    )

    expect(rows[0]).toEqual({ allowlist: null, is_admin: null, old_trigger: 0 })
  })
})

test.describe("audit log", () => {
  test("an audited write with no actor is refused", async () => {
    await inRolledBackTransaction(async (sql) => {
      await expect(
        sql.query("update public.staff_members set full_name = 'Nobody knows' where id = $1", [ADMISSIONS.id]),
      ).rejects.toThrow("no_audit_actor")
    })
  })

  test("after set_audit_actor('system') an update is accepted and logs only the changed fields", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.staff_members set full_name = 'Renamed Admissions' where id = $1", [ADMISSIONS.id])

      const { rows } = await sql.query(
        `select table_name, row_id, lead_id, action, old_values, new_values, scope, actor_kind, actor_staff_id
         from public.audit_log where row_id = $1 and created_at >= now()`,
        [ADMISSIONS.id],
      )
      expect(rows).toEqual([
        {
          table_name: "staff_members",
          row_id: ADMISSIONS.id,
          lead_id: null,
          action: "update",
          old_values: { full_name: ADMISSIONS.name },
          new_values: { full_name: "Renamed Admissions" },
          scope: "staff_admin",
          actor_kind: "system",
          actor_staff_id: null,
        },
      ])
    })
  })

  test("an insert logs the whole row", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      const role = await sql.query("insert into public.roles (name) values ('Audited insert') returning id")

      const { rows } = await sql.query(
        "select action, old_values, new_values from public.audit_log where row_id = $1",
        [role.rows[0].id],
      )
      expect(rows).toHaveLength(1)
      expect(rows[0].action).toBe("insert")
      expect(rows[0].old_values).toBeNull()
      expect(rows[0].new_values).toMatchObject({ id: role.rows[0].id, name: "Audited insert", permissions: [], retired: false })
    })
  })

  test("an update that changes nothing logs nothing", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.staff_members set full_name = full_name where id = $1", [ADMISSIONS.id])

      const { rows } = await sql.query("select 1 from public.audit_log where row_id = $1 and created_at >= now()", [
        ADMISSIONS.id,
      ])
      expect(rows).toEqual([])
    })
  })

  test("a write under a staff session names that staff member as the actor", async () => {
    await inRolledBackTransaction(async (sql) => {
      const { rows: users } = await sql.query("select user_id from public.staff_members where id = $1", [MANAGER.id])
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: users[0].user_id, role: "authenticated" }),
      ])
      await sql.query("update public.staff_members set full_name = 'Corrected Name' where id = $1", [ADMISSIONS.id])

      const { rows } = await sql.query(
        "select actor_kind, actor_staff_id from public.audit_log where row_id = $1 and created_at >= now()",
        [ADMISSIONS.id],
      )
      expect(rows).toEqual([{ actor_kind: "staff", actor_staff_id: MANAGER.id }])
    })
  })

  test("the lead id comes from the column a table registers", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("create table public.audit_probe (id uuid primary key default gen_random_uuid(), lead uuid)")
      await sql.query(
        "insert into public.audit_scopes (table_name, scope, lead_id_column) values ('public.audit_probe', 'lead', 'lead')",
      )
      await sql.query(
        "create trigger audit_row_change after insert or update on public.audit_probe for each row execute function public.audit_row_change()",
      )
      await sql.query("select public.set_audit_actor('system')")
      const leadId = SEEDED_LEAD_ID
      const probe = await sql.query("insert into public.audit_probe (lead) values ($1) returning id", [leadId])

      const { rows } = await sql.query("select lead_id, scope from public.audit_log where row_id = $1", [
        probe.rows[0].id,
      ])
      expect(rows).toEqual([{ lead_id: leadId, scope: "lead" }])
    })
  })

  test("audited tables refuse DELETE, for the database owner too", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await expect(sql.query("delete from public.roles where name = 'Receptionist'")).rejects.toThrow("delete_refused")
    })
    await inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await expect(sql.query("delete from public.staff_members where id = $1", [DEACTIVATED.id])).rejects.toThrow(
        "delete_refused",
      )
    })
  })

  test("audited tables refuse DELETE with the secret key", async () => {
    const { error } = await secretClient().from("staff_members").delete().eq("id", DEACTIVATED.id)
    expect(error).not.toBeNull()

    const { data } = await secretClient().from("staff_members").select("id").eq("id", DEACTIVATED.id)
    expect(data).toEqual([{ id: DEACTIVATED.id }])
  })

  test("audit_log refuses UPDATE, DELETE and INSERT with the secret key", async () => {
    const secret = secretClient()
    const { data: rows } = await secret.from("audit_log").select("id").limit(1)
    const id = rows?.[0]?.id
    expect(id).toBeDefined()

    expect((await secret.from("audit_log").update({ action: "tampered" }).eq("id", id)).error).not.toBeNull()
    expect((await secret.from("audit_log").delete().eq("id", id)).error).not.toBeNull()
    expect(
      (
        await secret
          .from("audit_log")
          .insert({ action: "forged", scope: "staff_admin", actor_kind: "system" })
      ).error,
    ).not.toBeNull()

    const { data: after } = await secret.from("audit_log").select("action").eq("id", id)
    expect(after?.[0]?.action).not.toBe("tampered")
  })

  test("audit_log refuses UPDATE and DELETE for the database owner", async () => {
    await inRolledBackTransaction(async (sql) => {
      await expect(sql.query("update public.audit_log set action = 'tampered'")).rejects.toThrow(
        "audit_log_is_append_only",
      )
    })
    await inRolledBackTransaction(async (sql) => {
      await expect(sql.query("delete from public.audit_log")).rejects.toThrow("audit_log_is_append_only")
    })
  })

  test("audit rows are readable only under their scope's permission", async () => {
    const marker = `scope-probe-${randomUUID().slice(0, 8)}`
    await asSystem((sql) =>
      sql.query(
        `insert into public.audit_log (action, scope, actor_kind)
         values ($1, 'lead', 'system'), ($1, 'payment', 'system'), ($1, 'staff_admin', 'system')`,
        [marker],
      ),
    )
    const paymentsOnly = await createThrowawayStaff(["payments.view"])

    async function scopesSeenBy(person: FixtureStaff) {
      const { data } = await (await signedIn(person)).from("audit_log").select("scope").eq("action", marker)
      return (data ?? []).map((row) => row.scope).sort()
    }

    expect(await scopesSeenBy(MANAGER)).toEqual(["lead", "payment", "staff_admin"])
    expect(await scopesSeenBy(ADMISSIONS)).toEqual(["lead", "payment"])
    expect(await scopesSeenBy(ACCOUNTANT)).toEqual(["lead", "payment"])
    expect(await scopesSeenBy(paymentsOnly)).toEqual(["payment"])
    expect(await scopesSeenBy(DEACTIVATED)).toEqual([])
  })
})

test.describe("record_action", () => {
  test("refuses a caller whose role lacks the kind's permission", async () => {
    const { error } = await (await signedIn(ACCOUNTANT)).rpc("record_action", { kind: "invite_sent" })

    expect(error?.message).toBe("not_permitted")
  })

  test("refuses a deactivated staff member", async () => {
    const { error } = await (await signedIn(DEACTIVATED)).rpc("record_action", { kind: "invite_sent" })

    expect(error?.message).toBe("not_permitted")
  })

  test("writes one row with the kind's scope and the caller as actor", async () => {
    const invited = randomUUID()
    const client = await signedIn(MANAGER)

    const { data: id, error } = await client.rpc("record_action", {
      kind: "invite_sent",
      details: { staff_member_id: invited },
    })
    expect(error).toBeNull()

    const { data } = await client
      .from("audit_log")
      .select("table_name, row_id, lead_id, action, new_values, scope, actor_kind, actor_staff_id")
      .eq("id", id)
    expect(data).toEqual([
      {
        table_name: null,
        row_id: null,
        lead_id: null,
        action: "invite_sent",
        new_values: { staff_member_id: invited },
        scope: "staff_admin",
        actor_kind: "staff",
        actor_staff_id: MANAGER.id,
      },
    ])
  })

  test("a lead-scoped kind needs a lead id", async () => {
    const kind = `probe_${randomUUID().slice(0, 8)}`
    await asSystem((sql) =>
      sql.query("insert into public.audit_action_kinds (kind, permission, scope) values ($1, 'leads.view', 'lead')", [
        kind,
      ]),
    )
    const client = await signedIn(ADMISSIONS)

    expect((await client.rpc("record_action", { kind })).error?.message).toBe("lead_required")

    // A lead id must name a real lead: audit_log.lead_id references leads.
    const leadId = SEEDED_LEAD_ID
    const { data: id, error } = await client.rpc("record_action", { kind, lead_id: leadId })
    expect(error).toBeNull()
    const { data } = await client.from("audit_log").select("lead_id, scope, actor_staff_id").eq("id", id)
    expect(data).toEqual([{ lead_id: leadId, scope: "lead", actor_staff_id: ADMISSIONS.id }])
  })

  test("refuses an unknown kind", async () => {
    const { error } = await (await signedIn(MANAGER)).rpc("record_action", { kind: "made_up" })

    expect(error?.message).toBe("unknown_action_kind")
  })
})
