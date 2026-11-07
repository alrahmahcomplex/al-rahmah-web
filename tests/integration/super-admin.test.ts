import { randomUUID } from "node:crypto"

import { describe, expect, test } from "vitest"

import { getLeadHistory } from "@/lib/services/audit"
import { getStaffAdminHistory, getStaffAndRoles } from "@/lib/services/staff-admin"
import { getAuditPage, getLeadStatusSince } from "@/lib/services/system-audit"

import { asSystem, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SUPER_ADMIN } from "../support/fixtures"

// The Super Admin (#237): a role that exists only through a migration, holds
// every permission, never appears on any reader, and alone reads the audit
// history. The freeze itself is recorded in api-surface.test.ts; the
// permission answers in staff-rbac.test.ts.

const SEEDED_ROLES = [MANAGER, ADMISSIONS, ACCOUNTANT]
// Applied, with its creation in the audit log (supabase/seeds/00_base.sql).
const SEEDED_LEAD = { id: "1ead0000-0000-4000-8000-000000000001", admissionNumber: "ADMSN-90001" }

function newEmail() {
  return `super-admin-${randomUUID().slice(0, 8)}@example.test`
}

async function roleId(name: string): Promise<string> {
  return asSystem(async (sql) => (await sql.query<{ id: string }>("select id from public.roles where name = $1", [name])).rows[0].id)
}

describe("the Super Admin is invisible", () => {
  test("the Roles reader never returns the role, to an administrator or to the Super Admin", async () => {
    for (const person of [MANAGER, SUPER_ADMIN]) {
      const { data, error } = await (await signedIn(person)).from("roles").select("id, name")
      expect(error).toBeNull()
      expect(data?.map((role) => role.id), person.name).not.toContain(SUPER_ADMIN.roleId)
      expect(data?.map((role) => role.name), person.name).not.toContain("Super Admin")
    }
  })

  test("Staff and roles shows neither the role nor its holder, nor audit.view, nor counts the holder", async () => {
    for (const person of [MANAGER, SUPER_ADMIN]) {
      const overview = await getStaffAndRoles(await signedIn(person))
      if (!overview.ok) throw new Error("Staff and roles could not be read")
      expect(overview.data.roles.map((role) => role.id), person.name).not.toContain(SUPER_ADMIN.roleId)
      expect(overview.data.staff.map((s) => s.id), person.name).not.toContain(SUPER_ADMIN.id)
      expect(overview.data.staff.map((s) => s.email), person.name).not.toContain(SUPER_ADMIN.email)
      expect(overview.data.permissions.map((p) => p.name), person.name).not.toContain("audit.view")
      const holders = overview.data.roles.reduce((sum, role) => sum + role.activeHolders, 0)
      expect(holders, person.name).toBe(overview.data.staff.filter((s) => s.active).length)
    }
  })

  test("an administrator reads no row of the holder, while the holder reads their own", async () => {
    const asManager = await (await signedIn(MANAGER)).from("staff_members").select("id").eq("id", SUPER_ADMIN.id)
    expect(asManager.data).toEqual([])
    const asHolder = await (await signedIn(SUPER_ADMIN)).from("staff_members").select("id, full_name").eq("id", SUPER_ADMIN.id)
    expect(asHolder.data).toEqual([{ id: SUPER_ADMIN.id, full_name: SUPER_ADMIN.name }])
  })

  test("every staff write a Manager aims at the holder or the role is not_found", async () => {
    const client = await signedIn(MANAGER)
    const managerRole = await roleId("Admissions Manager")
    const calls: [string, Record<string, unknown>, string][] = [
      ["assign_staff_role", { staff_id: SUPER_ADMIN.id, role_id: managerRole }, "not_found"],
      ["assign_staff_role", { staff_id: ADMISSIONS.id, role_id: SUPER_ADMIN.roleId }, "not_found"],
      ["deactivate_staff_member", { staff_id: SUPER_ADMIN.id }, "not_found"],
      ["reactivate_staff_member", { staff_id: SUPER_ADMIN.id }, "not_found"],
      ["correct_staff_name", { staff_id: SUPER_ADMIN.id, full_name: "Someone Else" }, "not_found"],
      ["resendable_invite", { staff_id: SUPER_ADMIN.id }, "not_found"],
      ["invite_staff_member", { full_name: "Into Super Admin", email: newEmail(), role_id: SUPER_ADMIN.roleId }, "not_found"],
      ["invite_staff_member", { full_name: "Same Email", email: SUPER_ADMIN.email, role_id: managerRole }, "email_taken"],
      ["rename_role", { role_id: SUPER_ADMIN.roleId, name: "Renamed" }, "not_found"],
      ["set_role_permission", { role_id: SUPER_ADMIN.roleId, permission: "leads.view", granted: false }, "not_found"],
      ["retire_role", { role_id: SUPER_ADMIN.roleId }, "not_found"],
    ]
    for (const [fn, args, code] of calls) {
      const { error } = await client.rpc(fn, args)
      expect(error?.message, `${fn} ${JSON.stringify(args)}`).toBe(code)
      // No name or role reaches the caller.
      expect(error?.details ?? "", fn).not.toContain(SUPER_ADMIN.name)
    }
  })

  test("audit.view reads as an unknown permission on any role", async () => {
    const created = await (await signedIn(SUPER_ADMIN)).rpc("create_role", { name: `Audit probe ${randomUUID().slice(0, 8)}` })
    expect(created.error).toBeNull()
    for (const person of [MANAGER, SUPER_ADMIN]) {
      const { error } = await (await signedIn(person)).rpc("set_role_permission", {
        role_id: created.data.id,
        permission: "audit.view",
        granted: true,
      })
      expect(error?.message, person.name).toBe("unknown_permission")
    }
  })
})

describe("the Super Admin administers everything", () => {
  test("invites into any role, the Admissions Manager role included", async () => {
    const client = await signedIn(SUPER_ADMIN)
    for (const name of ["Admissions Manager", "Admissions Staff", "Accountant"]) {
      const { data, error } = await client.rpc("invite_staff_member", { full_name: `Invited ${name}`, email: newEmail(), role_id: await roleId(name) })
      expect(error, name).toBeNull()
      expect(data.role, name).toBe(name)
    }
  })

  test("creates a role and ticks its permissions, but leaves the Admissions Manager role to migrations (decision 1)", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const created = await client.rpc("create_role", { name: `Made role ${randomUUID().slice(0, 8)}` })
    expect(created.error).toBeNull()
    expect((await client.rpc("set_role_permission", { role_id: created.data.id, permission: "leads.view", granted: true })).error).toBeNull()

    const managerRole = await roleId("Admissions Manager")
    const { error } = await client.rpc("set_role_permission", { role_id: managerRole, permission: "leads.view", granted: false })
    expect(error?.message).toBe("administer_role_frozen")
  })

  test("deactivates and reactivates an Admissions Manager, and moves them to another role", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const invited = await client.rpc("invite_staff_member", { full_name: "Managed Manager", email: newEmail(), role_id: await roleId("Admissions Manager") })
    expect(invited.error).toBeNull()
    expect((await client.rpc("deactivate_staff_member", { staff_id: invited.data.id })).error).toBeNull()
    expect((await client.rpc("reactivate_staff_member", { staff_id: invited.data.id })).error).toBeNull()
    expect((await client.rpc("assign_staff_role", { staff_id: invited.data.id, role_id: await roleId("Accountant") })).error).toBeNull()
  })

  test("cannot change their own role or deactivate themselves", async () => {
    const client = await signedIn(SUPER_ADMIN)
    expect((await client.rpc("deactivate_staff_member", { staff_id: SUPER_ADMIN.id })).error?.message).toBe("own_account")
    const { error } = await client.rpc("assign_staff_role", { staff_id: SUPER_ADMIN.id, role_id: await roleId("Accountant") })
    expect(error?.message).toBe("own_role")
  })
})

describe("the audit history is the Super Admin's", () => {
  test("each seeded role is refused every audit read", async () => {
    for (const person of SEEDED_ROLES) {
      const client = await signedIn(person)
      expect((await client.from("audit_log").select("id").limit(5)).data, person.roleName).toEqual([])
      expect(await getLeadHistory(client, SEEDED_LEAD.id), person.roleName).toEqual({ ok: false, error: "forbidden" })
      expect(await getAuditPage(client, {}), person.roleName).toEqual({ ok: false, error: "forbidden" })
      const overview = await getStaffAndRoles(client)
      if (overview.ok) expect(await getStaffAdminHistory(client, overview.data), person.roleName).toEqual({ ok: true, data: [] })
    }
  })

  test("each seeded role still reads when a lead's status last changed", async () => {
    for (const person of SEEDED_ROLES) {
      const since = await getLeadStatusSince(await signedIn(person), SEEDED_LEAD.id)
      expect(since.ok, person.roleName).toBe(true)
      if (since.ok) expect(since.data, person.roleName).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  test("the Super Admin reads every area, filtered by record, area, actor and date", async () => {
    const client = await signedIn(SUPER_ADMIN)

    const all = await getAuditPage(client, {})
    if (!all.ok) throw new Error(all.error)
    expect(new Set(all.data.entries.map((entry) => entry.area)).size).toBeGreaterThan(0)

    const byRecord = await getAuditPage(client, { record: SEEDED_LEAD.admissionNumber.toLowerCase() })
    if (!byRecord.ok) throw new Error(byRecord.error)
    expect(byRecord.data.total).toBeGreaterThan(0)
    for (const entry of byRecord.data.entries) expect([entry.leadId, entry.recordId]).toContain(SEEDED_LEAD.id)

    const staffAdmin = await getAuditPage(client, { area: "staff_admin", actor: "system", record: SUPER_ADMIN.roleId })
    if (!staffAdmin.ok) throw new Error(staffAdmin.error)
    expect(staffAdmin.data.total).toBeGreaterThan(0)
    for (const entry of staffAdmin.data.entries) {
      expect(entry.area).toBe("staff_admin")
      expect(entry.actor).toBe("System")
    }
    // The migration's own row: the role's creation, by the system.
    expect(staffAdmin.data.entries.map((entry) => [entry.recordId, entry.action])).toEqual([[SUPER_ADMIN.roleId, "insert"]])

    const future = await getAuditPage(client, { from: "2999-01-01" })
    expect(future).toEqual({ ok: true, data: { entries: [], total: 0, page: 1, pageCount: 1 } })

    expect(await getAuditPage(client, { record: "not a record" })).toEqual({ ok: false, error: "invalid" })
  })

  test("names the Super Admin as the actor of what they did", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const created = await client.rpc("create_role", { name: `Actor probe ${randomUUID().slice(0, 8)}` })
    expect(created.error).toBeNull()
    const page = await getAuditPage(client, { actor: SUPER_ADMIN.id, record: created.data.id })
    if (!page.ok) throw new Error(page.error)
    expect(page.data.entries.map((entry) => entry.actor)).toEqual([SUPER_ADMIN.name])
  })
})
