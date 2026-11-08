import { randomInt, randomUUID } from "node:crypto"

import { Client } from "pg"
import { describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { tanzaniaToday } from "@/lib/school-calendar"
import { setAgentEmail } from "@/lib/services/agent-invites"
import { getLeadHistory } from "@/lib/services/audit"
import { createLead, updateGuardianContact } from "@/lib/services/leads"
import { getResultReleases } from "@/lib/services/result-release"
import { getStaffAdminHistory, getStaffAndRoles } from "@/lib/services/staff-admin"
import { getAuditPage, getLeadStatusSince } from "@/lib/services/system-audit"

import { asSystem, inRolledBackTransaction, signedIn } from "../support/db"
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

// An Approved agent with no login, for the email check (supabase/seeds/40_agents.sql).
const UNJOINED_AGENT = "a4a4a4a4-0000-4000-8000-000000000002"
// A seeded interview; the permission check answers before anything is read.
const SEEDED_INTERVIEW = "1e7e0000-0000-4000-8000-000000000501"

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
      ["invite_staff_member", { full_name: "Same Email", email: SUPER_ADMIN.email, role_id: await roleId("Admissions Staff") }, "email_in_use"],
      // Role writes are the Super Admin's alone (#241), so a Manager is
      // refused before the role is even looked up.
      ["rename_role", { role_id: SUPER_ADMIN.roleId, name: "Renamed" }, "forbidden"],
      ["set_role_permission", { role_id: SUPER_ADMIN.roleId, permission: "leads.view", granted: false }, "forbidden"],
      ["retire_role", { role_id: SUPER_ADMIN.roleId }, "forbidden"],
      ["reactivate_role", { role_id: SUPER_ADMIN.roleId }, "forbidden"],
      ["set_role_manages", { role_id: managerRole, managed_role_id: SUPER_ADMIN.roleId, manages: true }, "forbidden"],
    ]
    for (const [fn, args, code] of calls) {
      const { error } = await client.rpc(fn, args)
      expect(error?.message, `${fn} ${JSON.stringify(args)}`).toBe(code)
      // No name or role reaches the caller.
      expect(error?.details ?? "", fn).not.toContain(SUPER_ADMIN.name)
    }
  })

  test("an agent email the Super Admin holds reads as in use, with no name", async () => {
    const result = await setAgentEmail(await signedIn(MANAGER), UNJOINED_AGENT, SUPER_ADMIN.email.toUpperCase())
    expect(result).toEqual({ ok: false, error: { kind: "email-taken", email: SUPER_ADMIN.email, agent: null } })
  })

  test("the Super Admin's own role reads as not_found to the Super Admin's role writes", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const managerRole = await roleId("Admissions Manager")
    const calls: [string, Record<string, unknown>][] = [
      ["rename_role", { role_id: SUPER_ADMIN.roleId, name: "Renamed" }],
      ["set_role_permission", { role_id: SUPER_ADMIN.roleId, permission: "leads.view", granted: false }],
      ["retire_role", { role_id: SUPER_ADMIN.roleId }],
      ["reactivate_role", { role_id: SUPER_ADMIN.roleId }],
      ["set_role_manages", { role_id: managerRole, managed_role_id: SUPER_ADMIN.roleId, manages: true }],
      ["set_role_manages", { role_id: SUPER_ADMIN.roleId, managed_role_id: managerRole, manages: true }],
      ["create_role", { name: `Over the top ${randomUUID().slice(0, 8)}`, managed_by: [SUPER_ADMIN.roleId] }],
    ]
    for (const [fn, args] of calls) {
      expect((await client.rpc(fn, args)).error?.message, `${fn} ${JSON.stringify(args)}`).toBe("not_found")
    }
  })

  test("audit.view reads as an unknown permission on any role", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const created = await client.rpc("create_role", { name: `Audit probe ${randomUUID().slice(0, 8)}` })
    expect(created.error).toBeNull()
    const { error } = await client.rpc("set_role_permission", { role_id: created.data.id, permission: "audit.view", granted: true })
    expect(error?.message).toBe("unknown_permission")
    const withIt = await client.rpc("create_role", { name: `Audit probe ${randomUUID().slice(0, 8)}`, permissions: ["audit.view"] })
    expect(withIt.error?.message).toBe("unknown_permission")
  })
})

describe("the Super Admin's freeze under the secret key", () => {
  // The secret key's writes run as service_role, which may not execute
  // super_admin_role_id(); the freeze triggers run with the writer's rights,
  // so they must not call it. Each case opens a fresh connection.
  async function asServiceRole<T>(work: (sql: Client) => Promise<T>): Promise<T> {
    const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await sql.connect()
    try {
      await sql.query("begin")
      await sql.query("set local role service_role")
      await sql.query("select public.set_audit_actor('system')")
      return await work(sql)
    } finally {
      await sql.query("rollback").catch(() => {})
      await sql.end()
    }
  }

  test("an ordinary staff update goes through", async () => {
    await asServiceRole(async (sql) => {
      const { rowCount } = await sql.query("update public.staff_members set notices_seen_at = now() where id = $1", [MANAGER.id])
      expect(rowCount).toBe(1)
    })
  })

  test("deactivating the holder is refused as super_admin_frozen, not a permission error", async () => {
    await asServiceRole(async (sql) => {
      await expect(sql.query("update public.staff_members set active = false where id = $1", [SUPER_ADMIN.id])).rejects.toThrow(
        "super_admin_frozen",
      )
    })
  })

  test("renaming the role is refused as super_admin_frozen", async () => {
    await asServiceRole(async (sql) => {
      await expect(sql.query("update public.roles set name = 'Renamed' where id = $1", [SUPER_ADMIN.roleId])).rejects.toThrow(
        "super_admin_frozen",
      )
    })
  })
})

describe("an inactive Super Admin", () => {
  // Lifts the freeze inside a rolled-back transaction, as only a migration
  // could, then asks has_permission as the holder. Replica mode skips the
  // refusal triggers for this transaction only. ALTER TABLE ... DISABLE
  // TRIGGER would take an ACCESS EXCLUSIVE lock on both tables and deadlock
  // with test files writing to them in parallel (#245).
  async function answerWhen(change: string): Promise<boolean[]> {
    return inRolledBackTransaction(async (sql) => {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query("set local session_replication_role = replica")
      await sql.query(change)
      await sql.query("set local session_replication_role = origin")
      await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: SUPER_ADMIN.userId, role: "authenticated" })])
      await sql.query("set local role authenticated")
      const { rows } = await sql.query<{ a: boolean; b: boolean }>(
        "select public.has_permission('leads.view') as a, public.has_permission('permission.added_later') as b",
      )
      return [rows[0].a, rows[0].b]
    })
  }

  test("a deactivated holder is refused every permission", async () => {
    expect(await answerWhen(`update public.staff_members set active = false where id = '${SUPER_ADMIN.id}'`)).toEqual([false, false])
  })

  test("a holder whose role is retired is refused every permission", async () => {
    expect(await answerWhen(`update public.roles set retired = true where id = '${SUPER_ADMIN.roleId}'`)).toEqual([false, false])
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

  test("creates a role and ticks its permissions, and edits the Admissions Manager role like any other (#241)", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const created = await client.rpc("create_role", { name: `Made role ${randomUUID().slice(0, 8)}` })
    expect(created.error).toBeNull()
    expect((await client.rpc("set_role_permission", { role_id: created.data.id, permission: "leads.view", granted: true })).error).toBeNull()

    // Ticking a permission the role holds already changes nothing, so the
    // shared fixture stays as it was; the point is that it isn't refused.
    const managerRole = await roleId("Admissions Manager")
    const { error } = await client.rpc("set_role_permission", { role_id: managerRole, permission: "leads.view", granted: true })
    expect(error).toBeNull()
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
      if (!overview.ok) throw new Error("Staff and roles could not be read")
      expect(await getStaffAdminHistory(client, overview.data), person.roleName).toEqual({ ok: false, error: "forbidden" })
      expect(await getResultReleases(client, SEEDED_INTERVIEW), person.roleName).toEqual({ ok: false, error: "forbidden" })
      expect((await client.from("agent_status_changes").select("id").limit(5)).data, person.roleName).toEqual([])
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
    // The lead's own rows, and its parent or guardian contact's.
    for (const entry of byRecord.data.entries) {
      if (entry.table !== "guardian_contacts") expect([entry.leadId, entry.recordId]).toContain(SEEDED_LEAD.id)
    }

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

  test("the Super Admin reads the Staff and roles history and every release", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const overview = await getStaffAndRoles(client)
    if (!overview.ok) throw new Error("Staff and roles could not be read")
    expect((await getStaffAdminHistory(client, overview.data)).ok).toBe(true)
    expect((await getResultReleases(client, SEEDED_INTERVIEW)).ok).toBe(true)
  })

  test("a page past the last shows the first page, with the total", async () => {
    const client = await signedIn(SUPER_ADMIN)
    const page = await getAuditPage(client, { record: SEEDED_LEAD.admissionNumber, page: 999 })
    if (!page.ok) throw new Error(page.error)
    expect(page.data.page).toBe(1)
    expect(page.data.total).toBeGreaterThan(0)
    expect(page.data.entries.length).toBeGreaterThan(0)
  })

  test("an Admission Number also finds changes to the student's parent or guardian", async () => {
    const admissions = await signedIn(ADMISSIONS)
    const thisYear = Number(tanzaniaToday().slice(0, 4))
    const phone = `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
    const created = await createLead(admissions, {
      guardian: { contact: { fullName: "Audit Parent", relationship: "Mother", phone } },
      student: { fullName: `Audit Pupil ${randomUUID().slice(0, 8)}`, className: "STD 2", enrollmentYear: thisYear + 1, dayOrBoarding: "Day" },
      start: { kind: "walk-in", visitDate: tanzaniaToday() },
    })
    if (!created.ok) throw new Error(JSON.stringify(created.error))
    const contactId = await asSystem(async (sql) =>
      (await sql.query<{ id: string }>("select guardian_contact_id as id from public.leads where id = $1", [created.data.leadId])).rows[0].id,
    )
    expect((await updateGuardianContact(admissions, contactId, { fullName: "Audit Parent Renamed" })).ok).toBe(true)

    const page = await getAuditPage(await signedIn(SUPER_ADMIN), { record: created.data.admissionNumber })
    if (!page.ok) throw new Error(page.error)
    const contactRows = page.data.entries.filter((entry) => entry.table === "guardian_contacts")
    expect(contactRows.map((entry) => [entry.action, entry.recordId])).toEqual([
      ["update", contactId],
      ["insert", contactId],
    ])
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
