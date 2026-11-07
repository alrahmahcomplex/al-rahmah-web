import { randomUUID } from "node:crypto"

import type { SupabaseClient } from "@supabase/supabase-js"
import { Client } from "pg"
import { beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { ROLE_TEMPLATES, roleTemplate } from "@/lib/role-templates"
import { getStaffAndRoles } from "@/lib/services/staff-admin"
import { getAuditPage } from "@/lib/services/system-audit"

import { asSystem, createThrowawayStaff, inRolledBackTransaction, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN, type FixtureStaff } from "../support/fixtures"

// Roles v2 (#241): the Super Admin makes every role from a template and
// alone changes roles; a role's managed set decides whose staff its holders
// manage. Each template role that manages anyone is tested here as its
// holder: the seeded Admissions Manager over Admissions Staff, and a Head
// Accountant and an Administrator made from their templates for this file.

// supabase/seeds/00_base.sql recreates these under fixed ids.
const ROLE = {
  admissionsStaff: "7e000000-0000-4000-8000-000000000001",
  admissionsManager: "7e000000-0000-4000-8000-000000000002",
  accountant: "7e000000-0000-4000-8000-000000000003",
}

const unique = (name: string) => `${name} ${randomUUID().slice(0, 8)}`
const newEmail = () => `roles-v2-${randomUUID().slice(0, 8)}@example.test`

type Person = FixtureStaff & { roleId: string }


async function superAdmin(): Promise<SupabaseClient> {
  return signedIn(SUPER_ADMIN)
}

// A role made by the Super Admin from `template`, under a name of its own so
// runs never collide, managing the given roles.
async function fromTemplate(template: string, manages: string[]): Promise<string> {
  const { data, error } = await (await superAdmin()).rpc("create_role", {
    name: unique(template),
    permissions: roleTemplate(template)!.permissions,
    manages,
    managed_by: [],
  })
  if (error) throw new Error(`Could not create ${template}: ${error.message}`)
  return data.id
}

function code(result: { error: { message: string } | null }): string | null {
  return result.error?.message ?? null
}

let headAccountantRole: string
let administratorRole: string
let headAccountant: Person
let administrator: Person

beforeAll(async () => {
  headAccountantRole = await fromTemplate("Head Accountant", [ROLE.accountant])
  administratorRole = await fromTemplate("Administrator", [ROLE.admissionsManager, headAccountantRole])
  headAccountant = await createThrowawayStaff([], { onRole: headAccountantRole })
  administrator = await createThrowawayStaff([], { onRole: administratorRole })
})

describe("roles become templates", () => {
  test("the migration removed the three seeded roles and recorded it; the local seed brought them back with the templates' grants", async () => {
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ removed: string[] }>(
        "select new_values -> 'removed' as removed from public.audit_log where action = 'roles_became_templates'",
      ),
    )
    expect(rows).toEqual([{ removed: ["Accountant", "Admissions Manager", "Admissions Staff"] }])

    const roles = await inRolledBackTransaction((sql) =>
      sql.query<{ id: string; name: string; permissions: string[] }>("select id, name, permissions from public.roles where id = any ($1)", [
        Object.values(ROLE),
      ]),
    )
    for (const role of roles.rows) {
      expect(role.permissions, role.name).toEqual([...roleTemplate(role.name)!.permissions].sort())
    }
  })

  test("staff.administer is gone from the permission list and from every role", async () => {
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ permissions: number; roles: number; kind: string | null }>(
        `select (select count(*)::int from public.permissions where name = 'staff.administer') as permissions,
                (select count(*)::int from public.roles where 'staff.administer' = any (permissions)) as roles,
                (select permission from public.audit_action_kinds where kind = 'invite_sent') as kind`,
      ),
    )
    expect(rows).toEqual([{ permissions: 0, roles: 0, kind: null }])
  })

  test("the legacy guards are gone", async () => {
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query<{ name: string }>(
        `select proname as name from pg_proc
         where pronamespace = 'public'::regnamespace and proname in ('refuse_no_administrator_left', 'administrator_count')
         union all
         select tgname from pg_trigger where tgname = 'refuse_no_administrator_left'
         union all
         select proname from pg_proc where pronamespace = 'public'::regnamespace and prosrc like '%administer_role_frozen%'`,
      ),
    )
    expect(rows).toEqual([])
  })
})

describe("the Super Admin creates each template", () => {
  test("every template becomes a role in one call, the template's permissions and managed set included", async () => {
    const client = await superAdmin()
    for (const template of ROLE_TEMPLATES) {
      const { data, error } = await client.rpc("create_role", {
        name: unique(template.name),
        permissions: template.permissions,
        manages: template.manages.length > 0 ? [ROLE.admissionsStaff] : [],
        managed_by: [],
      })
      expect(error, template.name).toBeNull()
      const { rows } = await inRolledBackTransaction((sql) =>
        sql.query<{ permissions: string[]; manages: number }>(
          `select permissions, (select count(*)::int from public.role_managed_roles m where m.role_id = r.id and m.active) as manages
           from public.roles r where r.id = $1`,
          [data.id],
        ),
      )
      expect(rows[0], template.name).toEqual({
        permissions: [...template.permissions].sort(),
        manages: template.manages.length > 0 ? 1 : 0,
      })
    }
  })

  test("a role made later joins the managed set of the role that should manage it", async () => {
    const manager = await fromTemplate("Admissions Manager", [])
    const { data, error } = await (await superAdmin()).rpc("create_role", {
      name: unique("Admissions Staff"),
      permissions: roleTemplate("Admissions Staff")!.permissions,
      manages: [],
      managed_by: [manager],
    })
    expect(error).toBeNull()
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query("select role_id, managed_role_id, active from public.role_managed_roles where managed_role_id = $1", [data.id]),
    )
    expect(rows).toEqual([{ role_id: manager, managed_role_id: data.id, active: true }])
  })

  test("the managed set refuses a role managing itself, a retired role, a missing answer and an unknown role", async () => {
    const client = await superAdmin()
    const role = await fromTemplate("Accountant", [])
    const retired = await fromTemplate("Accountant", [])
    expect(code(await client.rpc("retire_role", { role_id: retired }))).toBeNull()

    expect(code(await client.rpc("set_role_manages", { role_id: role, managed_role_id: role, manages: true }))).toBe("manages_itself")
    expect(code(await client.rpc("set_role_manages", { role_id: role, managed_role_id: retired, manages: true }))).toBe("role_retired")
    expect(code(await client.rpc("set_role_manages", { role_id: role, managed_role_id: ROLE.accountant, manages: null }))).toBe("manages_required")
    expect(code(await client.rpc("set_role_manages", { role_id: role, managed_role_id: randomUUID(), manages: true }))).toBe("not_found")
    expect(code(await client.rpc("reactivate_role", { role_id: role }))).toBe("role_not_retired")
  })
})

describe("only the Super Admin changes roles", () => {
  const writes = (role: string): [string, Record<string, unknown>][] => [
    ["create_role", { name: unique("Refused") }],
    ["create_role", { name: unique("Refused"), permissions: ["leads.view"], manages: [role] }],
    ["rename_role", { role_id: role, name: unique("Renamed") }],
    ["set_role_permission", { role_id: role, permission: "leads.view", granted: true }],
    ["retire_role", { role_id: role }],
    ["reactivate_role", { role_id: role }],
    ["set_role_manages", { role_id: role, managed_role_id: ROLE.accountant, manages: true }],
  ]

  test("every role write is forbidden to each template role's holder, the Administrator and the Admissions Manager included", async () => {
    const target = await fromTemplate("Accountant", [])
    for (const person of [MANAGER, ADMISSIONS, ACCOUNTANT, headAccountant, administrator]) {
      const client = await signedIn(person)
      for (const [fn, args] of writes(target)) {
        expect(code(await client.rpc(fn, args)), `${person.roleName}: ${fn}`).toBe("forbidden")
      }
      // The Admissions Manager role is no different.
      expect(
        code(await client.rpc("set_role_permission", { role_id: ROLE.admissionsManager, permission: "payments.record", granted: true })),
        person.roleName,
      ).toBe("forbidden")
    }
  })

  test("no managed-set pair is written outside the Super Admin's functions", async () => {
    const client = await signedIn(administrator)
    await client.from("role_managed_roles").insert({ role_id: administratorRole, managed_role_id: ROLE.accountant })
    await client.from("role_managed_roles").update({ active: false }).eq("role_id", administratorRole)
    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query("select managed_role_id, active from public.role_managed_roles where role_id = $1 order by managed_role_id", [administratorRole]),
    )
    expect(rows).toEqual(
      [ROLE.admissionsManager, headAccountantRole].sort().map((id) => ({ managed_role_id: id, active: true })),
    )
  })
})

describe("the Admissions Manager manages Admissions Staff", () => {
  test("invites, resends, deactivates, reactivates and corrects the name of Admissions Staff", async () => {
    const client = await signedIn(MANAGER)
    const invited = await client.rpc("invite_staff_member", { full_name: "Managed Invitee", email: newEmail(), role_id: ROLE.admissionsStaff })
    expect(invited.error).toBeNull()
    expect(code(await client.rpc("resendable_invite", { staff_id: invited.data.id }))).toBeNull()
    expect((await client.rpc("invited_staff_members")).data).toContain(invited.data.id)

    const target = await createThrowawayStaff([], { onRole: ROLE.admissionsStaff })
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: target.id }))).toBeNull()
    expect(code(await client.rpc("reactivate_staff_member", { staff_id: target.id }))).toBeNull()
    expect(code(await client.rpc("correct_staff_name", { staff_id: target.id, full_name: `${target.name} Fixed` }))).toBeNull()
  })

  test("is forbidden to invite an Accountant, to touch an Accountant, or to move anyone out of the set", async () => {
    const client = await signedIn(MANAGER)
    const accountant = await createThrowawayStaff([], { onRole: ROLE.accountant })
    const staff = await createThrowawayStaff([], { onRole: ROLE.admissionsStaff })

    expect(code(await client.rpc("invite_staff_member", { full_name: "Out Of Set", email: newEmail(), role_id: ROLE.accountant }))).toBe("forbidden")
    expect(code(await client.rpc("invite_staff_member", { full_name: "Out Of Set", email: newEmail(), role_id: ROLE.admissionsManager }))).toBe("forbidden")
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: accountant.id }))).toBe("forbidden")
    expect(code(await client.rpc("reactivate_staff_member", { staff_id: accountant.id }))).toBe("forbidden")
    expect(code(await client.rpc("correct_staff_name", { staff_id: accountant.id, full_name: "Changed" }))).toBe("forbidden")
    expect(code(await client.rpc("assign_staff_role", { staff_id: accountant.id, role_id: ROLE.admissionsStaff }))).toBe("forbidden")
    expect(code(await client.rpc("assign_staff_role", { staff_id: staff.id, role_id: ROLE.accountant }))).toBe("forbidden")
    expect(code(await client.rpc("assign_staff_role", { staff_id: staff.id, role_id: ROLE.admissionsManager }))).toBe("forbidden")
    expect(code(await client.rpc("assign_staff_role", { staff_id: SECOND_MANAGER_ID, role_id: ROLE.admissionsStaff }))).toBe("forbidden")

    const { rows } = await inRolledBackTransaction((sql) =>
      sql.query("select id, role_id, active from public.staff_members where id = any ($1) order by id", [[accountant.id, staff.id]]),
    )
    expect(rows).toEqual(
      [
        { id: accountant.id, role_id: ROLE.accountant, active: true },
        { id: staff.id, role_id: ROLE.admissionsStaff, active: true },
      ].sort((a, b) => a.id.localeCompare(b.id)),
    )
  })

  test("sees only the Admissions Staff on Staff and roles, and every role read-only", async () => {
    const overview = await getStaffAndRoles(await signedIn(MANAGER))
    if (!overview.ok) throw new Error("Staff and roles could not be read")
    const roles = new Set(overview.data.staff.filter((s) => s.id !== MANAGER.id).map((s) => s.roleId))
    expect([...roles]).toEqual([ROLE.admissionsStaff])
    expect(overview.data.roles.map((r) => r.id)).toEqual(expect.arrayContaining(Object.values(ROLE)))
    expect(overview.data.roles.find((r) => r.id === ROLE.admissionsManager)?.manages).toEqual([ROLE.admissionsStaff])
  })

  test("loses the set the moment the Super Admin takes the role out of it", async () => {
    const managerRole = await fromTemplate("Admissions Manager", [ROLE.admissionsStaff])
    const manager = await createThrowawayStaff([], { onRole: managerRole })
    const client = await signedIn(manager)
    const invite = () => client.rpc("invite_staff_member", { full_name: "Live Check", email: newEmail(), role_id: ROLE.admissionsStaff })
    expect(code(await invite())).toBeNull()

    expect(code(await (await superAdmin()).rpc("set_role_manages", { role_id: managerRole, managed_role_id: ROLE.admissionsStaff, manages: false }))).toBeNull()
    // The set is now empty, so they manage nobody at all.
    expect(code(await invite())).toBe("not_permitted")
  })
})

const SECOND_MANAGER_ID = "a1a1a1a1-0000-4000-8000-000000000002"

describe("a Head Accountant manages Accountants", () => {
  test("invites and deactivates an Accountant", async () => {
    const client = await signedIn(headAccountant)
    expect(code(await client.rpc("invite_staff_member", { full_name: "New Accountant", email: newEmail(), role_id: ROLE.accountant }))).toBeNull()
    const target = await createThrowawayStaff([], { onRole: ROLE.accountant })
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: target.id }))).toBeNull()
  })

  test("is forbidden over Admissions Staff, and to move an Accountant out of the set", async () => {
    const client = await signedIn(headAccountant)
    const target = await createThrowawayStaff([], { onRole: ROLE.accountant })
    expect(code(await client.rpc("invite_staff_member", { full_name: "Wrong Set", email: newEmail(), role_id: ROLE.admissionsStaff }))).toBe("forbidden")
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: ADMISSIONS.id }))).toBe("forbidden")
    expect(code(await client.rpc("assign_staff_role", { staff_id: target.id, role_id: headAccountantRole }))).toBe("forbidden")
  })
})

describe("an Administrator manages Managers and Head Accountants, never roles", () => {
  test("deactivates and reactivates a Manager, and moves them between roles inside the set", async () => {
    const client = await signedIn(administrator)
    const target = await createThrowawayStaff([], { onRole: ROLE.admissionsManager })
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: target.id }))).toBeNull()
    expect(code(await client.rpc("reactivate_staff_member", { staff_id: target.id }))).toBeNull()
    expect(code(await client.rpc("assign_staff_role", { staff_id: target.id, role_id: headAccountantRole }))).toBeNull()
    expect(code(await client.rpc("assign_staff_role", { staff_id: target.id, role_id: ROLE.admissionsStaff }))).toBe("forbidden")
    expect(code(await client.rpc("invite_staff_member", { full_name: "New Manager", email: newEmail(), role_id: ROLE.admissionsManager }))).toBeNull()
  })

  test("is forbidden over Admissions Staff and Accountants, whom only their own managers reach", async () => {
    const client = await signedIn(administrator)
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: ADMISSIONS.id }))).toBe("forbidden")
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: ACCOUNTANT.id }))).toBe("forbidden")
    expect(code(await client.rpc("invite_staff_member", { full_name: "Wrong Set", email: newEmail(), role_id: ROLE.accountant }))).toBe("forbidden")
  })

  test("reads no audit history", async () => {
    const client = await signedIn(administrator)
    expect((await client.from("audit_log").select("id").limit(5)).data).toEqual([])
    expect(await getAuditPage(client, {})).toEqual({ ok: false, error: "forbidden" })
  })
})

// The five staff actions for every template role that manages anyone,
// inside its managed set and outside it (#241). Each guard has a case that
// turns red if it goes.
describe("the five staff actions, inside and outside each managed set", () => {
  type Scope = { label: string; holder: () => Person | FixtureStaff; inside: () => string[]; outside: () => string[] }
  const SCOPES: Scope[] = [
    {
      label: "Admissions Manager",
      holder: () => MANAGER,
      inside: () => [ROLE.admissionsStaff],
      outside: () => [ROLE.accountant, ROLE.admissionsManager],
    },
    {
      label: "Head Accountant",
      holder: () => headAccountant,
      inside: () => [ROLE.accountant],
      outside: () => [ROLE.admissionsStaff, headAccountantRole, administratorRole],
    },
    {
      label: "Administrator",
      holder: () => administrator,
      inside: () => [ROLE.admissionsManager, headAccountantRole],
      outside: () => [ROLE.admissionsStaff, ROLE.accountant, administratorRole],
    },
  ]

  // Someone on `role` who has not opened their invite: a record with no login.
  async function invitedOn(role: string): Promise<string> {
    return asSystem(async (sql) => {
      const { rows } = await sql.query<{ id: string }>(
        "insert into public.staff_members (full_name, email, role_id) values ($1, $2, $3) returning id",
        [unique("Invited"), newEmail(), role],
      )
      return rows[0].id
    })
  }

  async function deactivatedOn(role: string): Promise<string> {
    const person = await createThrowawayStaff([], { onRole: role })
    await asSystem((sql) => sql.query("update public.staff_members set active = false where id = $1", [person.id]))
    return person.id
  }

  for (const scope of SCOPES) {
    describe(scope.label, () => {
      test("invites into each role in the set, and is forbidden every other", async () => {
        const client = await signedIn(scope.holder())
        for (const role of scope.inside()) {
          expect(code(await client.rpc("invite_staff_member", { full_name: "Inside", email: newEmail(), role_id: role })), role).toBeNull()
        }
        for (const role of scope.outside()) {
          expect(code(await client.rpc("invite_staff_member", { full_name: "Outside", email: newEmail(), role_id: role })), role).toBe("forbidden")
        }
      })

      test("resends an invite inside the set, and is forbidden outside it", async () => {
        const client = await signedIn(scope.holder())
        for (const role of scope.inside()) {
          expect(code(await client.rpc("resendable_invite", { staff_id: await invitedOn(role) })), role).toBeNull()
        }
        for (const role of scope.outside()) {
          expect(code(await client.rpc("resendable_invite", { staff_id: await invitedOn(role) })), role).toBe("forbidden")
        }
      })

      test("deactivates inside the set, and is forbidden outside it", async () => {
        const client = await signedIn(scope.holder())
        for (const role of scope.inside()) {
          const target = await createThrowawayStaff([], { onRole: role })
          expect(code(await client.rpc("deactivate_staff_member", { staff_id: target.id })), role).toBeNull()
        }
        for (const role of scope.outside()) {
          const target = await createThrowawayStaff([], { onRole: role })
          expect(code(await client.rpc("deactivate_staff_member", { staff_id: target.id })), role).toBe("forbidden")
        }
      })

      test("reactivates inside the set, and is forbidden outside it", async () => {
        const client = await signedIn(scope.holder())
        for (const role of scope.inside()) {
          expect(code(await client.rpc("reactivate_staff_member", { staff_id: await deactivatedOn(role) })), role).toBeNull()
        }
        for (const role of scope.outside()) {
          expect(code(await client.rpc("reactivate_staff_member", { staff_id: await deactivatedOn(role) })), role).toBe("forbidden")
        }
      })

      test("reassigns only between roles in the set: never into it from outside, nor out of it", async () => {
        const client = await signedIn(scope.holder())
        const inside = scope.inside()
        for (const from of inside) {
          for (const to of scope.outside()) {
            const target = await createThrowawayStaff([], { onRole: from })
            expect(code(await client.rpc("assign_staff_role", { staff_id: target.id, role_id: to })), `${from} -> ${to}`).toBe("forbidden")
          }
        }
        for (const from of scope.outside()) {
          const target = await createThrowawayStaff([], { onRole: from })
          expect(code(await client.rpc("assign_staff_role", { staff_id: target.id, role_id: inside[0] })), `${from} -> ${inside[0]}`).toBe(
            "forbidden",
          )
        }
        if (inside.length > 1) {
          const target = await createThrowawayStaff([], { onRole: inside[0] })
          expect(code(await client.rpc("assign_staff_role", { staff_id: target.id, role_id: inside[1] }))).toBeNull()
        }
      })
    })
  }
})

// A Manager who types an email already on staff learns who holds it only if
// they manage that person's role (#241 review).
describe("an invite never names someone outside the caller's managed set", () => {
  test("an Accountant's email, invited into Admissions Staff by the Manager, is forbidden with no name or status", async () => {
    const { error } = await (await signedIn(MANAGER)).rpc("invite_staff_member", {
      full_name: "Same Email",
      email: ACCOUNTANT.email.toUpperCase(),
      role_id: ROLE.admissionsStaff,
    })
    expect(error?.message).toBe("forbidden")
    expect(error?.details ?? "").not.toContain(ACCOUNTANT.name)
    expect(error?.details ?? "").not.toContain("active")
  })

  test("an email inside the set still names its holder", async () => {
    const { error } = await (await signedIn(MANAGER)).rpc("invite_staff_member", {
      full_name: "Same Email",
      email: ADMISSIONS.email,
      role_id: ROLE.admissionsStaff,
    })
    expect(error?.message).toBe("already_staff")
    expect(JSON.parse(error?.details ?? "{}")).toEqual({ email: ADMISSIONS.email, name: ADMISSIONS.name, active: true })
  })

  test("losing a race to an Accountant's record with the same email is forbidden too, with no name", async () => {
    const email = newEmail()
    const first = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    const manager = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await first.connect()
    await manager.connect()
    try {
      // The Accountant's record is written and not yet committed...
      await first.query("begin")
      await first.query("select public.set_audit_actor('system')")
      await first.query("insert into public.staff_members (full_name, email, role_id) values ('Racing Accountant', $1, $2)", [
        email,
        ROLE.accountant,
      ])

      // ...so the Manager's invite finds nobody, then waits on the unique email.
      await manager.query("set statement_timeout = '15s'")
      await manager.query("begin")
      await manager.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: "11111111-1111-4111-8111-111111111111", role: "authenticated" }),
      ])
      const invite = manager
        .query("select public.invite_staff_member('Racing Invitee', $1, $2)", [email, ROLE.admissionsStaff])
        .then(
          () => null,
          (error: { message: string; detail?: string }) => error,
        )
      // Wait until the invite is blocked on the uncommitted record, so it is
      // the unique index, not the first lookup, that refuses it.
      await expect
        .poll(async () =>
          inRolledBackTransaction(async (sql) =>
            (
              await sql.query<{ waiting: boolean }>(
                "select exists (select 1 from pg_stat_activity where pid <> pg_backend_pid() and query like '%Racing Invitee%' and wait_event_type = 'Lock') as waiting",
              )
            ).rows[0].waiting,
          ),
        )
        .toBe(true)
      await first.query("commit")

      const error = await invite
      expect(error?.message).toBe("forbidden")
      expect(error?.detail ?? "").not.toContain("Racing Accountant")
    } finally {
      await first.query("rollback").catch(() => {})
      await manager.query("rollback").catch(() => {})
      await first.end()
      await manager.end()
    }
  })
})

describe("a role with no managed set", () => {
  test("manages nobody: every staff write is not_permitted", async () => {
    const client = await signedIn(ACCOUNTANT)
    const target = await createThrowawayStaff([], { onRole: ROLE.accountant })
    expect(code(await client.rpc("invite_staff_member", { full_name: "Nobody", email: newEmail(), role_id: ROLE.accountant }))).toBe("not_permitted")
    expect(code(await client.rpc("deactivate_staff_member", { staff_id: target.id }))).toBe("not_permitted")
    expect(code(await client.rpc("resendable_invite", { staff_id: target.id }))).toBe("not_permitted")
    expect((await client.rpc("invited_staff_members")).data).toEqual([])
  })
})

// Each refusal on a connection of its own, as service_role: the secret key's
// writes run as that role, which may not execute super_admin_role_id() or
// is_super_admin(), and a shared connection once hid such a bug (#237).
describe("the refusals under the secret key, each on a fresh connection", () => {
  async function asServiceRole(statement: string, params: unknown[] = []): Promise<string> {
    const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await sql.connect()
    try {
      await sql.query("begin")
      await sql.query("set local role service_role")
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(statement, params)
      return "accepted"
    } catch (error) {
      return (error as Error).message
    } finally {
      await sql.query("rollback").catch(() => {})
      await sql.end()
    }
  }

  const cases: [string, string, unknown[], string][] = [
    ["create_role", "select public.create_role('Service role')", [], "forbidden"],
    ["rename_role", "select public.rename_role($1, 'Renamed')", [ROLE.accountant], "forbidden"],
    ["set_role_permission", "select public.set_role_permission($1, 'leads.view', true)", [ROLE.accountant], "forbidden"],
    ["retire_role", "select public.retire_role($1)", [ROLE.accountant], "forbidden"],
    ["reactivate_role", "select public.reactivate_role($1)", [ROLE.accountant], "forbidden"],
    ["set_role_manages", "select public.set_role_manages($1, $2, true)", [ROLE.accountant, ROLE.admissionsStaff], "forbidden"],
    ["a pair naming the Super Admin role", "insert into public.role_managed_roles (role_id, managed_role_id) values ($1, $2)", [ROLE.accountant, SUPER_ADMIN.roleId], "super_admin_frozen"],
    ["a pair under the Super Admin role", "insert into public.role_managed_roles (role_id, managed_role_id) values ($2, $1)", [ROLE.accountant, SUPER_ADMIN.roleId], "super_admin_frozen"],
    ["deleting a pair", "delete from public.role_managed_roles", [], "delete_refused"],
    ["truncating the pairs", "truncate public.role_managed_roles", [], "delete_refused"],
    [
      "an invite naming an Accountant's email",
      "select public.invite_staff_member('Same Email', $1, $2)",
      [ACCOUNTANT.email, ROLE.admissionsStaff],
      "not_permitted",
    ],
  ]
  for (const [what, statement, params, expected] of cases) {
    test(`${what} is refused with ${expected}`, async () => {
      expect(await asServiceRole(statement, params)).toBe(expected)
    })
  }

  test("an ordinary pair written directly still goes through, audited", async () => {
    const roles = await asSystem(async (sql) => {
      const role = await sql.query<{ id: string }>("insert into public.roles (name) values ($1) returning id", [unique("Pair probe")])
      return role.rows[0].id
    })
    expect(await asServiceRole("insert into public.role_managed_roles (role_id, managed_role_id) values ($1, $2)", [roles, ROLE.accountant])).toBe("accepted")
  })
})
