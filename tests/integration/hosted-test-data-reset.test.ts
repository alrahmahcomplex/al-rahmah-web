import { readFileSync } from "node:fs"

import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { inRolledBackTransaction, lockExclusively } from "../support/db"
import { MANAGER } from "../support/fixtures"

// The hosted reset migration (#197, owner decision 42) against the seeded
// local database. Every scenario runs the migration file's SQL inside a
// transaction that is rolled back, so the fixtures survive. The owner sets
// the cutoff at merge on the line the marker below annotates; the tests read
// whatever it holds. As checked in the line carries a sentinel, and the
// migration refuses to run while it does. One scenario runs the file
// unchanged and the others substitute a cutoff of their own.
//
// Lifetime: the migration classifies the tables that exist when it runs. Once
// it has run on hosted, later migrations may add tables it does not know, and
// applying it to a database holding them raises on purpose. When that
// happens the clearing scenarios below skip, the as-checked-in scenario
// expects that raise instead, and only the classification scenarios stay;
// the file can then be removed.

const FILE = "supabase/migrations/20261130990100_hosted_test_data_reset.sql"
// Annotates the `cutoff constant timestamptz := '...'` line, the one line the
// owner edits at merge.
const CUTOFF_MARKER = "-- SET AT MERGE (#197): cutoff"
// The literal the marked line carries as checked in. The migration refuses to
// run while the cutoff still equals it.
const SENTINEL = "'2020-01-01 00:00:00+00'"
// A set cutoff that every seeded or test-written row is newer than.
const PAST_CUTOFF = "'2026-01-01 00:00:00+00'"
const FUTURE_CUTOFF = "'2999-01-01 00:00:00+00'"
// The schemas the API exposes (supabase/config.toml); the migration
// classifies every base table in them.
const EXPOSED = ["public", "graphql_public"]

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
const KEPT = ["agent_access_settings", "audit_action_kinds", "audit_scopes", "permissions"]
// Roles are user-created too: every role goes, whatever a Manager named it,
// and the three seeded ones are inserted fresh with these sets, the ones
// 20260928000000_staff_members_and_roles.sql seeds plus the
// group_links.manage that 20261113110100_whatsapp_group_links.sql adds to
// the roles holding leads.edit.
const RESTORED = ["roles"]
const SEEDED_ROLES: Record<string, string[]> = {
  "Admissions Staff": [
    "leads.view", "leads.create", "leads.edit", "visits.record", "interviews.record",
    "results.send", "follow_ups.record", "leads.decline", "leads.close", "payments.view",
    "group_links.manage",
  ],
  "Admissions Manager": [
    "leads.view", "leads.create", "leads.edit", "visits.record", "interviews.record",
    "results.send", "follow_ups.record", "leads.decline", "leads.close",
    "reopenings.approve", "lifecycle.intervene", "agents.approve", "payments.view",
    "discounts.approve", "academic_years.manage", "staff.administer",
    "group_links.manage",
  ],
  Accountant: ["leads.view", "interview_payments.record", "payments.view", "payments.record"],
}

type Cutoff = { line: number; literal: string }

// The migration file, and the cutoff it sets: the one quoted timestamp
// literal on the marker line or on the `cutoff constant timestamptz :=` line
// the marker annotates. Throws rather than guessing, so a malformed edit at
// merge time fails every scenario with the reason.
function readMigration(): { lines: string[]; cutoff: Cutoff } {
  const lines = readFileSync(FILE, "utf8").split("\n")
  const markers = lines.flatMap((line, index) => (line.includes(CUTOFF_MARKER) ? [index] : []))
  if (markers.length !== 1) throw new Error(`${FILE} must carry "${CUTOFF_MARKER}" exactly once; it carries it ${markers.length} times`)
  const [marker] = markers
  for (let index = marker; index < Math.min(marker + 10, lines.length); index++) {
    if (index !== marker && !/^\s*cutoff\s+constant\s+timestamptz\s*:=/.test(lines[index])) continue
    const literal = /'\d{4}-\d{2}-\d{2}[^']*'/.exec(lines[index])
    if (literal) return { lines, cutoff: { line: index, literal: literal[0] } }
  }
  throw new Error(`${FILE}: no quoted timestamp on the marker line or on the cutoff assignment it annotates`)
}

// The migration's SQL as checked in, or with `cutoff` in place of the
// configured value.
function migration(cutoff?: string): string {
  const { lines, cutoff: configured } = readMigration()
  if (cutoff !== undefined) lines[configured.line] = lines[configured.line].replace(configured.literal, cutoff)
  return lines.join("\n")
}

function unquoted(literal: string): string {
  return literal.slice(1, -1)
}

// Every base table in the exposed schemas, as `schema.table`.
async function exposedTables(sql: Client): Promise<string[]> {
  const { rows } = await sql.query<{ name: string }>(
    `select ns.nspname || '.' || c.relname as name from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = any ($1) and c.relkind in ('r', 'p') order by 1`,
    [EXPOSED],
  )
  return rows.map((row) => row.name)
}

async function publicTables(sql: Client): Promise<string[]> {
  return (await exposedTables(sql)).filter((name) => name.startsWith("public.")).map((name) => name.slice("public.".length))
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

type Role = { id: string; name: string; retired: boolean; permissions: string[] }

async function roles(sql: Client): Promise<Role[]> {
  return (await sql.query<Role>("select id, name, retired, permissions from public.roles order by lower(name)")).rows
}

type RolesRecord = { before: number; removed_names: string[]; recreated: number }

// The `roles` part of the reset record, the one `hosted_reset` audit row.
async function rolesRecord(sql: Client): Promise<RolesRecord> {
  const { rows } = await sql.query<{ roles: RolesRecord }>("select new_values -> 'roles' as roles from public.audit_log where action = 'hosted_reset'")
  expect(rows).toHaveLength(1)
  return rows[0].roles
}

function expectSeededRoles(found: Role[]): void {
  expect(sorted(found.map((role) => role.name))).toEqual(sorted(Object.keys(SEEDED_ROLES)))
  for (const role of found) {
    expect(role.retired, role.name).toBe(false)
    expect(sorted(role.permissions), role.name).toEqual(sorted(SEEDED_ROLES[role.name]))
  }
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

function sorted(values: string[]): string[] {
  return [...values].sort()
}

// Holds off writers in test files running alongside, so the counts taken
// before and after the migration describe the same data. Readers go on.
async function holdTables(sql: Client): Promise<void> {
  await lockExclusively(
    sql,
    [...CLEARED, ...KEPT, ...RESTORED].map((table) => `public.${table}`).concat(["auth.users", "auth.identities"]),
  )
}

// Empties the cleared tables and Auth inside `sql`'s transaction, the way a
// database that never held data looks, except for `except`. Replica mode
// skips every refusal and audit trigger for this transaction only, so the
// rows go without any schema change; the transaction is rolled back anyway.
async function emptied(sql: Client, except: string[] = []): Promise<void> {
  await sql.query("set local session_replication_role = replica")
  for (const table of CLEARED) {
    if (!except.includes(table)) await sql.query(`delete from public."${table}"`)
  }
  if (!except.includes("auth")) {
    await sql.query("delete from auth.identities")
    await sql.query("delete from auth.users")
  }
  await sql.query("set local session_replication_role = origin")
}

// Runs `query`, expecting it to raise, and leaves the transaction usable: a
// failed statement otherwise aborts it.
async function raised(sql: Client, query: string): Promise<{ message: string; detail?: string }> {
  await sql.query("savepoint raised")
  try {
    await sql.query(query)
  } catch (error) {
    await sql.query("rollback to savepoint raised")
    return error as { message: string; detail?: string }
  }
  throw new Error("the migration ran through instead of raising")
}

// Tables this migration was never told about: added by migrations after it.
const unknownTables = await inRolledBackTransaction(async (sql) =>
  (await exposedTables(sql)).filter((name) => ![...CLEARED, ...KEPT, ...RESTORED].some((table) => name === `public.${table}`)),
)

describe("the hosted reset migration", () => {
  test("the classification covers every table the migration knows, once each", () => {
    const all = [...CLEARED, ...KEPT, ...RESTORED]
    expect(all.filter((table, index) => all.indexOf(table) !== index)).toEqual([])
  })

  test("the cutoff sits once on the marked line, with its time zone, and Postgres reads it", async () => {
    const { cutoff } = readMigration()
    // Without a zone the hosted server's TimeZone setting would decide the moment.
    expect(cutoff.literal, "the cutoff must end in a UTC offset, Z or UTC").toMatch(/([+-]\d{2}(:?\d{2})?|Z|UTC)'$/i)
    await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ at: string }>("select $1::timestamptz::text as at", [unquoted(cutoff.literal)])
      expect(rows[0].at).toMatch(/^\d{4}-\d{2}-\d{2} /)
    })
  })

  test.skipIf(unknownTables.length > 0)("as checked in, it refuses the seeded database: the cutoff is still the sentinel, or the data is newer than the cutoff set", async () => {
    const { cutoff } = readMigration()
    await inRolledBackTransaction(async (sql) => {
      // One snapshot for the counts here and the migration's own, whatever
      // the test files running alongside insert meanwhile.
      await sql.query("set transaction isolation level repeatable read")
      const { rows: sentinel } = await sql.query<{ unset: boolean }>("select $1::timestamptz = $2::timestamptz as unset", [unquoted(cutoff.literal), unquoted(SENTINEL)])
      if (sentinel[0].unset) {
        const failure = await raised(sql, migration())
        expect(failure.message).toBe("hosted_reset_cutoff_not_configured")
        expect(failure.detail).toContain("SET AT MERGE (#197)")
        return
      }

      // A cutoff set at merge. Seeds and test rows are written at test time,
      // so they are newer than any past moment; a cutoff ahead of this
      // machine's clock (a proof run before merge) would find nothing newer,
      // so one staff member is dated just after it first.
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(
        `insert into public.staff_members (full_name, email, role_id, created_at)
         select 'Cutoff Probe', 'cutoff-probe-' || gen_random_uuid() || '@example.test', id, $1::timestamptz + interval '1 second'
         from public.roles where name = 'Admissions Manager'`,
        [unquoted(cutoff.literal)],
      )
      const { rows } = await sql.query<{ leads: number; agents: number; staff: number }>(
        `select (select count(*)::int from public.leads where created_at > $1::timestamptz) as leads,
                (select count(*)::int from public.marketing_agents where registered_at > $1::timestamptz) as agents,
                (select count(*)::int from public.staff_members where created_at > $1::timestamptz) as staff`,
        [unquoted(cutoff.literal)],
      )
      const [newer] = rows
      expect(newer.staff).toBeGreaterThan(0)

      const failure = await raised(sql, migration())
      expect(failure.message).toBe("hosted_reset_newer_than_cutoff")
      const detail = /^(\d+) leads, (\d+) agents and (\d+) staff members are newer than the cutoff (.+)$/.exec(failure.detail ?? "")
      expect(detail, failure.detail).not.toBeNull()
      const [, leads, agents, staff, named] = detail!
      expect({ leads: Number(leads), agents: Number(agents), staff: Number(staff) }).toEqual(newer)
      // The cutoff it names is the configured one, however the server prints it.
      const { rows: same } = await sql.query<{ same: boolean }>("select $1::timestamptz = $2::timestamptz as same", [named, unquoted(cutoff.literal)])
      expect(same[0].same).toBe(true)
    })
  })

  test.skipIf(unknownTables.length === 0)("as checked in, once later migrations added tables it does not know, it refuses the database naming them", async () => {
    await inRolledBackTransaction(async (sql) => {
      await expect(sql.query(migration())).rejects.toMatchObject({
        message: "hosted_reset_unclassified_table",
        detail: `not on the cleared, kept or restored list: ${unknownTables.join(", ")}`,
      })
    })
  })

  test("it scans every schema the API exposes, and no table lives outside public today", async () => {
    // The list in supabase/config.toml and the one in the migration must
    // agree, or a table in a schema the API serves could escape the scan.
    const config = /^schemas\s*=\s*\[([^\]]*)\]/m.exec(readFileSync("supabase/config.toml", "utf8"))
    expect(config).not.toBeNull()
    const inConfig = [...config![1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
    const inMigration = /exposed constant text\[\] := array\[([^\]]*)\]/.exec(readFileSync(FILE, "utf8"))
    expect(inMigration).not.toBeNull()
    expect(sorted([...inMigration![1].matchAll(/'([^']+)'/g)].map((match) => match[1]))).toEqual(sorted(inConfig))
    expect(sorted(inConfig)).toEqual(sorted(EXPOSED))

    // graphql_public holds no base table (the local postgres role cannot even
    // create one there), so the public scan below is the one that can fire.
    await inRolledBackTransaction(async (sql) => {
      expect((await exposedTables(sql)).filter((name) => !name.startsWith("public."))).toEqual([])
    })
  })

  test("a table it does not classify stops it before anything changes", async () => {
    await inRolledBackTransaction(async (sql) => {
      await sql.query("create table public.zz_unclassified (id integer)")
      const failure = await raised(sql, migration(FUTURE_CUTOFF))
      expect(failure.message).toBe("hosted_reset_unclassified_table")
      expect(failure.detail).toMatch(/^not on the cleared, kept or restored list: /)
      expect(failure.detail).toMatch(/(: |, )public\.zz_unclassified(,|$)/)
    })
  })

  describe.skipIf(unknownTables.length > 0)("applied to a database holding no data", () => {
    test("with no leads, agents or staff members it does nothing, roles included, before it looks at the cutoff", async () => {
      await inRolledBackTransaction(async (sql) => {
        const notices: string[] = []
        sql.on("notice", (notice) => notices.push(notice.message ?? ""))
        await holdTables(sql)
        await emptied(sql)

        const before = await counts(sql)
        const rolesBefore = await roles(sql)
        expect(pick(before, CLEARED)).toEqual(Object.fromEntries(CLEARED.map((table) => [table, 0])))
        // The seeded Receptionist role is one the migrations did not seed; a
        // database with data would lose it.
        expect(rolesBefore.map((role) => role.name)).toContain("Receptionist")

        // As checked in, sentinel and all.
        await sql.query(migration())

        expect(notices.filter((notice) => notice.includes("no leads, agents or staff members"))).toHaveLength(1)
        expect(await counts(sql)).toEqual(before)
        expect(await roles(sql)).toEqual(rolesBefore)
        expect(await disabledTriggers(sql)).toEqual([])
      })
    })

    test("with only staff members, newer than the cutoff, it refuses: the staff guard stands on its own", async () => {
      await inRolledBackTransaction(async (sql) => {
        await holdTables(sql)
        await emptied(sql, ["staff_members", "auth"])
        const { rows } = await sql.query<{ staff: number }>("select count(*)::int as staff from public.staff_members where created_at > $1::timestamptz", [unquoted(PAST_CUTOFF)])
        expect(rows[0].staff).toBeGreaterThan(0)

        const failure = await raised(sql, migration(PAST_CUTOFF))
        expect(failure.message).toBe("hosted_reset_newer_than_cutoff")
        expect(failure.detail).toMatch(new RegExp(`^0 leads, 0 agents and ${rows[0].staff} staff members are newer than the cutoff `))
      })
    })
  })

  describe.skipIf(unknownTables.length > 0)("applied to the seeded database with the cutoff in the future", () => {
    test("clears every table a person wrote, keeps the migration-owned reference rows, restores the seeded roles, and records the counts", async () => {
      await inRolledBackTransaction(async (sql) => {
        const notices: string[] = []
        sql.on("notice", (notice) => notices.push(notice.message ?? ""))
        await holdTables(sql)

        // Roles a Manager made or changed: one created here, Admissions
        // Staff given a permission it is not seeded with, Accountant retired.
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("insert into public.roles (name, permissions) values ('Reset test role', array['leads.view'])")
        await sql.query("update public.roles set permissions = array_append(permissions, 'payments.record') where name = 'Admissions Staff'")
        await sql.query("update public.roles set retired = true where name = 'Accountant'")
        const rolesBefore = await roles(sql)
        const customRoles = rolesBefore.filter((role) => !(role.name in SEEDED_ROLES)).map((role) => role.name)
        expect(customRoles).toContain("Reset test role")
        expect(customRoles).toContain("Receptionist")

        const before = await counts(sql)
        const managerUserId = (await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [MANAGER.id])).rows[0].user_id
        expect(managerUserId).toBeTruthy()
        expect(before.staff_members).toBeGreaterThan(0)
        expect(before.leads).toBeGreaterThan(0)
        expect(before.marketing_agents).toBeGreaterThan(0)
        expect(before.fee_schedules).toBeGreaterThan(0)
        expect(before.roles).toBe(rolesBefore.length)
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

        // Restored: exactly the three seeded roles, unretired, with the
        // permissions the migrations give them, as new rows.
        const rolesAfter = await roles(sql)
        expect(after.roles).toBe(3)
        expectSeededRoles(rolesAfter)
        expect(rolesAfter.filter((role) => rolesBefore.some((was) => was.id === role.id))).toEqual([])

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
          new_values: {
            cutoff: string
            cleared: Record<string, number>
            auth_users: number
            auth_identities: number
            roles: RolesRecord
            agent_access: string
          }
        }>("select table_name, row_id, lead_id, action, scope, actor_kind, actor_staff_id, new_values from public.audit_log")
        expect(records).toHaveLength(1)
        const [record] = records
        expect(record).toMatchObject({ table_name: null, row_id: null, lead_id: null, action: "hosted_reset", scope: "staff_admin", actor_kind: "system", actor_staff_id: null })
        expect(record.new_values.cutoff).toMatch(/^2999-01-01/)
        expect(record.new_values.agent_access).toBe("off")
        expect(record.new_values.cleared).toEqual(pick(before, CLEARED))
        expect(record.new_values.auth_users).toBe(before["auth.users"])
        expect(record.new_values.auth_identities).toBe(before["auth.identities"])
        expect({ ...record.new_values.roles, removed_names: sorted(record.new_values.roles.removed_names) }).toEqual({
          before: rolesBefore.length,
          removed_names: sorted(rolesBefore.map((role) => role.name)),
          recreated: 3,
        })

        // A rerun finds the record and does nothing.
        notices.length = 0
        await sql.query(migration(FUTURE_CUTOFF))
        expect(notices.filter((n) => n.includes("reset record already exists"))).toHaveLength(1)
        expect(await counts(sql)).toEqual(after)
        expect(await roles(sql)).toEqual(rolesAfter)
      })
    })

    test("recreates the seeded roles whatever a Manager renamed them to, and the renamed rows go with the custom ones", async () => {
      await inRolledBackTransaction(async (sql) => {
        await holdTables(sql)

        // rename_role is a supported Manager action on any role without
        // staff.administer, so hosted may hold a seeded role under another
        // name. These are the updates rename_role makes.
        await sql.query("select public.set_audit_actor('system')")
        await sql.query("update public.roles set name = 'Front desk' where name = 'Admissions Staff'")
        await sql.query("update public.roles set name = 'Bursar' where name = 'Accountant'")
        await sql.query("insert into public.roles (name, permissions) values ('Reset rename test role', array['leads.view'])")
        const rolesBefore = await roles(sql)
        const namesBefore = rolesBefore.map((role) => role.name)
        expect(namesBefore).toEqual(expect.arrayContaining(["Admissions Manager", "Front desk", "Bursar", "Reset rename test role"]))
        expect(namesBefore).not.toContain("Admissions Staff")
        expect(namesBefore).not.toContain("Accountant")

        await sql.query(migration(FUTURE_CUTOFF))

        // The three defaults, with their sets, as new rows; nothing that was
        // there before, renamed or custom, survives.
        const rolesAfter = await roles(sql)
        expectSeededRoles(rolesAfter)
        expect(rolesAfter.filter((role) => rolesBefore.some((was) => was.id === role.id))).toEqual([])

        // The record names every role that went, the renamed ones under the
        // names they carried.
        const record = await rolesRecord(sql)
        expect({ ...record, removed_names: sorted(record.removed_names) }).toEqual({
          before: rolesBefore.length,
          removed_names: sorted(namesBefore),
          recreated: 3,
        })
        expect(record.removed_names).toEqual(expect.arrayContaining(["Front desk", "Bursar", "Reset rename test role"]))
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
