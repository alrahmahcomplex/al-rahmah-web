import { randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { PERMISSIONS } from "@/lib/permissions"
import { roleTemplate, ROLE_TEMPLATES } from "@/lib/role-templates"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  secretClient,
  signedIn,
} from "../support/db"
import { ACCOUNTANT, ADMISSIONS, DEACTIVATED, MANAGER, RETIRED_ROLE, SUPER_ADMIN, type FixtureStaff } from "../support/fixtures"

// What staff, roles and the audit log allow, tested through the same doors a
// user, a server or an operator would use. See tests/support/db.ts.

const SLICE_ONE_TABLES = [
  "permissions",
  "roles",
  "staff_members",
  "audit_log",
  "audit_scopes",
  "audit_action_kinds",
] as const

// The three roles the local seed recreates, with their templates' grants
// (#241, lib/role-templates.ts). Hosted starts with none of them.
const STARTING_GRANTS: Record<string, string[]> = Object.fromEntries(
  ["Admissions Staff", "Admissions Manager", "Accountant"].map((name) => [name, [...roleTemplate(name)!.permissions].sort()]),
)

// A lead from supabase/seeds/00_base.sql. audit_log.lead_id references leads, so a lead id
// in the log must name one that exists.
const SEEDED_LEAD_ID = "1ead0000-0000-4000-8000-000000000001"

// supabase/seeds/00_base.sql recreates the three roles under fixed ids.
const SEEDED_ROLE_IDS: Record<string, string> = {
  "Admissions Staff": "7e000000-0000-4000-8000-000000000001",
  "Admissions Manager": "7e000000-0000-4000-8000-000000000002",
  Accountant: "7e000000-0000-4000-8000-000000000003",
}

async function hasPermission(person: FixtureStaff, permission: string) {
  const { data, error } = await (await signedIn(person)).rpc("has_permission", { permission })
  expect(error).toBeNull()
  return data
}

describe("permissions and roles", () => {
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

  test("the database holds the same permissions as the app, each with a label", async () => {
    const { data } = await (await signedIn(SUPER_ADMIN))
      .from("permissions")
      .select("name, label")
      .order("position")

    expect(data?.map((p) => p.name)).toEqual([...PERMISSIONS])
    // Retired with roles v2 (#241): the managed set grants staff management.
    expect(data?.map((p) => p.name)).not.toContain("staff.administer")
    for (const permission of data ?? []) expect(permission.label).not.toBe("")
  })

  test("everyone but the Super Admin reads the list without audit.view (#237)", async () => {
    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT]) {
      const { data } = await (await signedIn(person)).from("permissions").select("name").order("position")
      expect(data?.map((p) => p.name), person.name).toEqual(PERMISSIONS.filter((p) => p !== "audit.view"))
    }
  })

  test("the three seeded roles hold their templates' grants", async () => {
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
    [MANAGER, "agents.approve", true],
    [MANAGER, "payments.record", false],
    [MANAGER, "staff.administer", false],
    [MANAGER, "reports.view", true],
    [ADMISSIONS, "reports.view", false],
    [ACCOUNTANT, "reports.view", false],
    [ADMISSIONS, "leads.create", true],
    [ADMISSIONS, "agents.approve", false],
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

  // The Super Admin (#237) answers true for every permission, including a
  // name no migration has added yet, so a later migration grants nothing.
  for (const permission of [...PERMISSIONS, "permission.added_later"]) {
    test(`has_permission('${permission}') is true for the Super Admin`, async () => {
      expect(await hasPermission(SUPER_ADMIN, permission)).toBe(true)
    })
  }

  test("current_staff_member gives the Super Admin every permission on the list", async () => {
    const { data } = await (await signedIn(SUPER_ADMIN)).rpc("current_staff_member").single<{ role_name: string; permissions: string[] }>()
    expect(data?.permissions).toEqual([...PERMISSIONS])
    expect(data?.role_name).toBe("Super Admin")
  })

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
      super_admin: false,
      managed_role_ids: [],
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

  test("staff whose role manages nobody read only their own staff record", async () => {
    const { data } = await (await signedIn(ADMISSIONS)).from("staff_members").select("id")

    expect(data).toEqual([{ id: ADMISSIONS.id }])
  })

  test("the Manager reads their own record and the Admissions Staff they manage, deactivated ones included (#241)", async () => {
    const { data } = await (await signedIn(MANAGER)).from("staff_members").select("id")
    const ids = data?.map((row) => row.id) ?? []

    for (const person of [MANAGER, ADMISSIONS, DEACTIVATED]) expect(ids).toContain(person.id)
    for (const person of [ACCOUNTANT, RETIRED_ROLE, SUPER_ADMIN]) expect(ids).not.toContain(person.id)
  })

  test("the Super Admin reads every staff record, their own included", async () => {
    const { data } = await (await signedIn(SUPER_ADMIN)).from("staff_members").select("id")
    const ids = data?.map((row) => row.id) ?? []

    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT, DEACTIVATED, RETIRED_ROLE, SUPER_ADMIN]) {
      expect(ids).toContain(person.id)
    }
  })

  test("current_staff_member names the Super Admin and each role's managed set", async () => {
    type Row = { super_admin: boolean; managed_role_ids: string[] }
    const asSuperAdmin = await (await signedIn(SUPER_ADMIN)).rpc("current_staff_member").single<Row>()
    const asManager = await (await signedIn(MANAGER)).rpc("current_staff_member").single<Row>()

    expect(asSuperAdmin.data).toMatchObject({ super_admin: true, managed_role_ids: [] })
    expect(asManager.data).toMatchObject({ super_admin: false, managed_role_ids: [SEEDED_ROLE_IDS["Admissions Staff"]] })
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

describe("accounts", () => {
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

describe("audit log", () => {
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

  test("audit rows are readable only by the Super Admin, in every scope (#237)", async () => {
    const marker = `scope-probe-${randomUUID().slice(0, 8)}`
    await asSystem((sql) =>
      sql.query(
        `insert into public.audit_log (action, scope, actor_kind)
         values ($1, 'lead', 'system'), ($1, 'payment', 'system'), ($1, 'staff_admin', 'system')`,
        [marker],
      ),
    )
    const paymentsOnly = await createThrowawayStaff(["payments.view"])

    async function scopesSeenBy(person: { email: string; password: string }) {
      const { data } = await (await signedIn(person)).from("audit_log").select("scope").eq("action", marker)
      return (data ?? []).map((row) => row.scope).sort()
    }

    expect(await scopesSeenBy(SUPER_ADMIN)).toEqual(["lead", "payment", "staff_admin"])
    expect(await scopesSeenBy(MANAGER)).toEqual([])
    expect(await scopesSeenBy(ADMISSIONS)).toEqual([])
    expect(await scopesSeenBy(ACCOUNTANT)).toEqual([])
    expect(await scopesSeenBy(paymentsOnly)).toEqual([])
    expect(await scopesSeenBy(DEACTIVATED)).toEqual([])
  })
})

describe("record_action", () => {
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

    // Only the Super Admin reads the log back (#237).
    const { data } = await (await signedIn(SUPER_ADMIN))
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
    const { data } = await (await signedIn(SUPER_ADMIN)).from("audit_log").select("lead_id, scope, actor_staff_id").eq("id", id)
    expect(data).toEqual([{ lead_id: leadId, scope: "lead", actor_staff_id: ADMISSIONS.id }])
  })

  test("refuses an unknown kind", async () => {
    const { error } = await (await signedIn(MANAGER)).rpc("record_action", { kind: "made_up" })

    expect(error?.message).toBe("unknown_action_kind")
  })
})

// Roles v2 (#241): only the Super Admin changes roles, and does each change.
// The refusals for everyone else are in tests/integration/roles-v2.test.ts
// and the api-surface test.
describe("the Super Admin changes every role", () => {
  const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`

  test("creates a role from each template in one call, with its permissions and managed set", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const made: Record<string, string> = {}
    for (const template of ROLE_TEMPLATES) {
      const manages = template.manages.map((name) => made[name])
      const { data, error } = await client.rpc("create_role", {
        name: unique(template.name),
        permissions: template.permissions,
        manages,
        managed_by: [],
      })
      expect(error, template.name).toBeNull()
      made[template.name] = data.id
    }

    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ id: string; permissions: string[]; manages: string[] }>(
        `select r.id, r.permissions,
                array(select m.managed_role_id::text from public.role_managed_roles m where m.role_id = r.id and m.active order by 1) as manages
         from public.roles r where r.id = any ($1)`,
        [Object.values(made)],
      ),
    )
    for (const template of ROLE_TEMPLATES) {
      const row = rows.find((r) => r.id === made[template.name])!
      expect(row.permissions, template.name).toEqual([...template.permissions].sort())
      expect(row.manages, template.name).toEqual(template.manages.map((name) => made[name]).sort())
    }
  })

  test("edits the permissions of a role, retires it, reactivates it and changes its managed set", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const role = (await client.rpc("create_role", { name: unique("Edited role") })).data as { id: string }

    expect((await client.rpc("set_role_permission", { role_id: role.id, permission: "leads.view", granted: true })).error).toBeNull()
    expect((await client.rpc("set_role_manages", { role_id: role.id, managed_role_id: SEEDED_ROLE_IDS.Accountant, manages: true })).error).toBeNull()
    expect((await client.rpc("set_role_manages", { role_id: role.id, managed_role_id: SEEDED_ROLE_IDS.Accountant, manages: false })).error).toBeNull()
    expect((await client.rpc("retire_role", { role_id: role.id })).error).toBeNull()
    expect((await client.rpc("reactivate_role", { role_id: role.id })).error).toBeNull()

    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query(
        `select r.permissions, r.retired, m.active as manages
         from public.roles r left join public.role_managed_roles m on m.role_id = r.id where r.id = $1`,
        [role.id],
      ),
    )
    expect(rows).toEqual([{ permissions: ["leads.view"], retired: false, manages: false }])
  })
})
