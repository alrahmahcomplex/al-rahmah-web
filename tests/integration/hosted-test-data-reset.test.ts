import { readFileSync } from "node:fs"

import { Client } from "pg"
import { describe, expect, test } from "vitest"

import { inRolledBackTransaction } from "../support/db"

// The hosted reset migration (#197, owner decision 42), as far as it can
// still be checked. The clearing scenarios that applied it to an empty and to
// the seeded database are gone: they passed on #236's CI, and the owner
// confirmed the reset on hosted. Later migrations added tables the migration
// does not classify, so applying it now raises before it clears anything,
// and those scenarios skipped on every run (#245). What stays guards the file
// itself: its classification, its cutoff line, the schemas it scans, and its
// refusal of any table it does not classify.

const FILE = "supabase/migrations/20261130990100_hosted_test_data_reset.sql"
// Annotates the `cutoff constant timestamptz := '...'` line, the one line the
// owner edits at merge.
const CUTOFF_MARKER = "-- SET AT MERGE (#197): cutoff"
// A cutoff ahead of every row, so only the table check can stop the run.
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
// Roles are user-created too: every role goes and the seeded ones come back.
const RESTORED = ["roles"]

type Cutoff = { line: number; literal: string }

// The migration file, and the cutoff it sets: the one quoted timestamp
// literal on the marker line or on the `cutoff constant timestamptz :=` line
// the marker annotates. Throws rather than guessing, so a malformed edit at
// merge time fails every test with the reason.
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

function sorted(values: string[]): string[] {
  return [...values].sort()
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

  test("as checked in, it refuses this database, naming the tables later migrations added", async () => {
    expect(unknownTables.length, "later migrations added tables the reset does not classify").toBeGreaterThan(0)
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
})
