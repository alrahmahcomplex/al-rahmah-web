import { readFileSync } from "node:fs"

import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { inRolledBackTransaction, lockExclusively } from "../support/db"
import { MANAGER } from "../support/fixtures"

// The hosted reset migration (#197, owner decision 42) against the seeded
// local database. Every scenario runs the migration file's SQL inside a
// transaction that is rolled back, so the fixtures survive. The cutoff is a
// placeholder the owner sets at merge; the file as checked in refuses the
// seeded data, which is newer than the placeholder, so one scenario runs it
// unchanged and the others substitute the cutoff.
//
// Lifetime: the migration classifies the tables that exist when it runs. Once
// it has run on hosted, later migrations may add tables it does not know, and
// applying it to a database holding them raises on purpose. When that
// happens the clearing scenarios below skip and only the classification
// scenario stays; the file can then be removed.

const FILE = "supabase/migrations/20261130990100_hosted_test_data_reset.sql"
const CUTOFF_PLACEHOLDER = "'2020-01-01 00:00:00+00'"
const FUTURE_CUTOFF = "'2999-01-01 00:00:00+00'"

// Decision 42: everything a person made goes; only what migrations create stays.
const CLEARED = [
  "admission_submissions",
  "agent_detached_logins",
  "agent_email_claims",
  "agent_events",
  "agent_invite_batches",
  "agent_link_requests",
  "agent_status_changes",
  "audit_log",
  "class_seats",
  "discount_requests",
  "fee_band_amounts",
  "fee_schedules",
  "follow_up_records",
  "follow_ups",
  "guardian_contacts",
  "import_batches",
  "interview_serial_counters",
  "interviews",
  "lead_fee_profiles",
  "leads",
  "marketing_agents",
  "payment_adjustments",
  "re_applications",
  "reopening_requests",
  "school_fee_payments",
  "staff_members",
  "whatsapp_group_invitations",
  "whatsapp_group_links",
]
const KEPT = ["agent_access_settings", "audit_action_kinds", "audit_scopes", "permissions", "roles"]

function migration(cutoff = CUTOFF_PLACEHOLDER): string {
  const text = readFileSync(FILE, "utf8")
  expect(text.split(CUTOFF_PLACEHOLDER)).toHaveLength(2)
  return text.replace(CUTOFF_PLACEHOLDER, cutoff)
}

async function publicTables(sql: Client): Promise<string[]> {
  const { rows } = await sql.query<{ name: string }>(
    "select c.relname as name from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p') order by 1",
  )
  return rows.map((row) => row.name)
}

async function counts(sql: Client): Promise<Record<string, number>> {
  const result: Record<string, number> = {}
  for (const table of await publicTables(sql)) {
    result[table] = (await sql.query<{ n: number }>(`select count(*)::int as n from public."${table}"`)).rows[0].n
  }
  result["auth.users"] = (await sql.query<{ n: number }>("select count(*)::int as n from auth.users")).rows[0].n
  result["auth.identities"] = (await sql.query<{ n: number }>("select count(*)::int as n from auth.identities")).rows[0].n
  return result
}

async function disabledTriggers(sql: Client): Promise<string[]> {
  const { rows } = await sql.query<{ name: string }>(
    `select c.relname || '.' || t.tgname as name from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relnamespace = 'public'::regnamespace and not t.tgisinternal and t.tgenabled not in ('O', 'A') order by 1`,
  )
  return rows.map((row) => row.name)
}

function pick(all: Record<string, number>, tables: string[]): Record<string, number> {
  return Object.fromEntries(tables.map((table) => [table, all[table]]))
}

// Holds off writers in test files running alongside, so the counts taken
// before and after the migration describe the same data. Readers go on.
async function holdTables(sql: Client): Promise<void> {
  await lockExclusively(sql, [...CLEARED, ...KEPT].map((table) => `public.${table}`).concat(["auth.users", "auth.identities"]))
}

// Tables this migration was never told about: added by migrations after it.
const unknownTables = await inRolledBackTransaction(async (sql) => (await publicTables(sql)).filter((t) => !CLEARED.includes(t) && !KEPT.includes(t)))

describe("the hosted reset migration", () => {
  test("the classification covers every table the migration knows", () => {
    expect(CLEARED.filter((t) => KEPT.includes(t))).toEqual([])
  })

  test("as checked in, it refuses the seeded database because the data is newer than the cutoff placeholder", async () => {
    const newer = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ leads: number; agents: number; staff: number }>(
        `select (select count(*)::int from public.leads where created_at > $1) as leads,
                (select count(*)::int from public.marketing_agents where registered_at > $1) as agents,
                (select count(*)::int from public.staff_members where created_at > $1) as staff`,
        [CUTOFF_PLACEHOLDER.replaceAll("'", "")],
      )
      return rows[0]
    })
    expect(newer.leads).toBeGreaterThan(0)

    await inRolledBackTransaction(async (sql) => {
      await expect(sql.query(migration())).rejects.toMatchObject({
        message: "hosted_reset_newer_than_cutoff",
        detail: expect.stringContaining(`${newer.leads} leads, ${newer.agents} agents and ${newer.staff} staff members`),
      })
    })
  })

  test("a table it does not classify stops it before anything changes", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("create table public.zz_unclassified (id integer)")
      await expect(sql.query(migration(FUTURE_CUTOFF))).rejects.toMatchObject({
        message: "hosted_reset_unclassified_table",
        detail: expect.stringContaining("zz_unclassified"),
      })
    })
  })

  describe.skipIf(unknownTables.length > 0)("applied to the seeded database with the cutoff in the future", () => {
    test("clears every table a person wrote, keeps the migration-owned reference rows, and records the counts", async () => {
      await inRolledBackTransaction(async (sql) => {
        const notices: string[] = []
        sql.on("notice", (notice) => notices.push(notice.message ?? ""))
        await holdTables(sql)

        const before = await counts(sql)
        const managerUserId = (await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [MANAGER.id])).rows[0].user_id
        expect(managerUserId).toBeTruthy()
        expect(before.staff_members).toBeGreaterThan(0)
        expect(before.leads).toBeGreaterThan(0)
        expect(before.marketing_agents).toBeGreaterThan(0)
        expect(before.fee_schedules).toBeGreaterThan(0)
        expect((await sql.query<{ enabled: boolean }>("select enabled from public.agent_access_settings")).rows[0].enabled).toBe(true)

        await sql.query(migration(FUTURE_CUTOFF))

        const after = await counts(sql)

        // Cleared: empty, except the audit log, which holds the one reset record.
        expect(pick(after, CLEARED)).toEqual(Object.fromEntries(CLEARED.map((t) => [t, t === "audit_log" ? 1 : 0])))
        expect(after["auth.users"]).toBe(0)
        expect(after["auth.identities"]).toBe(0)
        expect((await sql.query("select 1 from auth.users where id = $1", [managerUserId])).rowCount).toBe(0)
        expect((await sql.query("select 1 from public.staff_members where id = $1", [MANAGER.id])).rowCount).toBe(0)

        // Kept: untouched.
        expect(pick(after, KEPT)).toEqual(pick(before, KEPT))
        expect((await sql.query("select 1 from public.roles where name = 'Admissions Manager'")).rowCount).toBe(1)

        // Every refusal trigger is back on.
        expect(await disabledTriggers(sql)).toEqual([])

        // The switch is off, as system.
        expect((await sql.query("select enabled, changed_by_kind, changed_by from public.agent_access_settings")).rows).toEqual([
          { enabled: false, changed_by_kind: "system", changed_by: null },
        ])

        // The one surviving audit row is the reset record, with the counts.
        const { rows: records } = await sql.query<{
          table_name: string | null
          row_id: string | null
          lead_id: string | null
          action: string
          scope: string
          actor_kind: string
          actor_staff_id: string | null
          new_values: { cutoff: string; cleared: Record<string, number>; auth_users: number; auth_identities: number; agent_access: string }
        }>("select table_name, row_id, lead_id, action, scope, actor_kind, actor_staff_id, new_values from public.audit_log")
        expect(records).toHaveLength(1)
        const [record] = records
        expect(record).toMatchObject({ table_name: null, row_id: null, lead_id: null, action: "hosted_reset", scope: "staff_admin", actor_kind: "system", actor_staff_id: null })
        expect(record.new_values.cutoff).toMatch(/^2999-01-01/)
        expect(record.new_values.agent_access).toBe("off")
        expect(record.new_values.cleared).toEqual(pick(before, CLEARED))
        expect(record.new_values.auth_users).toBe(before["auth.users"])
        expect(record.new_values.auth_identities).toBe(before["auth.identities"])

        // A rerun finds the record and does nothing.
        notices.length = 0
        await sql.query(migration(FUTURE_CUTOFF))
        expect(notices.filter((n) => n.includes("reset record already exists"))).toHaveLength(1)
        expect(await counts(sql)).toEqual(after)
      })
    })

    test("nothing is left that could sign in or that a person wrote, so the owner bootstraps the first staff member afterwards", async () => {
      await inRolledBackTransaction(async (sql) => {
        await holdTables(sql)
        await sql.query(migration(FUTURE_CUTOFF))
        const { rows } = await sql.query<{ staff: number; users: number; sessions: number; refresh_tokens: number }>(
          `select (select count(*)::int from public.staff_members) as staff, (select count(*)::int from auth.users) as users,
                  (select count(*)::int from auth.sessions) as sessions, (select count(*)::int from auth.refresh_tokens) as refresh_tokens`,
        )
        expect(rows[0]).toEqual({ staff: 0, users: 0, sessions: 0, refresh_tokens: 0 })

        // The bootstrap from docs/agents/hosted-services.md still works on the emptied database.
        await sql.query("select public.set_audit_actor('system')")
        await sql.query(
          `insert into public.staff_members (full_name, email, role_id)
           select 'First Manager', 'first-manager@example.test', id from public.roles where name = 'Admissions Manager'`,
        )
        expect((await sql.query("select count(*)::int as n from public.staff_members")).rows[0].n).toBe(1)
      })
    })
  })
})
