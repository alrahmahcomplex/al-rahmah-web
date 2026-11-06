import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

// The permanent refusal-trigger test (#197). ADR 4 gives every audited table
// a trigger that refuses DELETE and one that refuses TRUNCATE, makes
// audit_log append-only, and lets append-only tables refuse UPDATE too. The
// hosted reset migration disables the delete refusals for the length of its
// transaction, so this test reads the catalog and fails when any migration
// has left a refusal trigger missing or disabled.

type Trigger = {
  table: string
  name: string
  // pg_trigger.tgenabled: O (origin, the normal state), A (always), D (disabled), R (replica only).
  enabled: string
  fn: string
  timing: "before" | "after" | "instead"
  level: "row" | "statement"
  events: string
}

// The audited tables that never change a row once written.
const APPEND_ONLY = [
  "agent_email_claims",
  "agent_events",
  "agent_status_changes",
  "follow_up_records",
  "follow_ups",
  "import_batches",
  "whatsapp_group_invitations",
]

let sql: Client
let audited: string[]
let triggers: Trigger[]

beforeAll(async () => {
  sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  audited = (await sql.query<{ table: string }>("select table_name::regclass::text as table from public.audit_scopes order by 1")).rows.map(
    (row) => row.table.replace(/^public\./, ""),
  )
  triggers = (
    await sql.query<Trigger>(
      `select c.relname as table, t.tgname as name, t.tgenabled as enabled, p.proname as fn,
         case when t.tgtype & 2 > 0 then 'before' when t.tgtype & 64 > 0 then 'instead' else 'after' end as timing,
         case when t.tgtype & 1 > 0 then 'row' else 'statement' end as level,
         concat_ws(' ', case when t.tgtype & 4 > 0 then 'insert' end, case when t.tgtype & 8 > 0 then 'delete' end,
                        case when t.tgtype & 16 > 0 then 'update' end, case when t.tgtype & 32 > 0 then 'truncate' end) as events
       from pg_trigger t
       join pg_class c on c.oid = t.tgrelid
       join pg_namespace n on n.oid = c.relnamespace
       join pg_proc p on p.oid = t.tgfoid
       where n.nspname = 'public' and not t.tgisinternal
       order by 1, 2`,
    )
  ).rows
})

afterAll(async () => {
  await sql?.end()
})

function find(table: string, name: string): Trigger | undefined {
  return triggers.find((t) => t.table === table && t.name === name)
}

function enabled(trigger: Trigger | undefined): boolean {
  return trigger !== undefined && (trigger.enabled === "O" || trigger.enabled === "A")
}

// `${table}.${name}` for every audited table whose trigger is missing,
// disabled or not what `expected` describes.
function wrong(name: string, expected: Omit<Trigger, "table" | "name" | "enabled">): string[] {
  return audited
    .filter((table) => {
      const trigger = find(table, name)
      return !enabled(trigger) || trigger?.fn !== expected.fn || trigger.timing !== expected.timing || trigger.level !== expected.level || trigger.events !== expected.events
    })
    .map((table) => `${table}.${name}`)
}

describe("refusal triggers", () => {
  test("the catalog registers the audited tables", () => {
    expect(audited.length).toBeGreaterThan(20)
    expect(audited).toContain("leads")
    expect(audited).toContain("staff_members")
  })

  test("every audited table writes its history through the one audit trigger", () => {
    expect(
      audited.filter((table) => {
        const trigger = find(table, "audit_row_change")
        return !enabled(trigger) || trigger?.fn !== "audit_row_change" || trigger.timing !== "after" || trigger.level !== "row" || !trigger.events.includes("insert")
      }),
    ).toEqual([])
  })

  test("every audited table refuses DELETE and TRUNCATE", () => {
    expect(wrong("refuse_delete", { fn: "refuse_delete", timing: "before", level: "row", events: "delete" })).toEqual([])
    expect(wrong("refuse_truncate", { fn: "refuse_delete", timing: "before", level: "statement", events: "truncate" })).toEqual([])
  })

  test("the audit log refuses UPDATE, DELETE and TRUNCATE", () => {
    expect(find("audit_log", "refuse_audit_log_change")).toMatchObject({ enabled: "O", fn: "refuse_audit_log_change", timing: "before", level: "row", events: "delete update" })
    expect(find("audit_log", "refuse_audit_log_truncate")).toMatchObject({ enabled: "O", fn: "refuse_audit_log_change", timing: "before", level: "statement", events: "truncate" })
  })

  test("the append-only tables refuse UPDATE, and only they carry that trigger", () => {
    const missing = APPEND_ONLY.filter((table) => {
      const trigger = find(table, "refuse_update")
      return !enabled(trigger) || trigger?.timing !== "before" || trigger.level !== "row" || trigger.events !== "update"
    })
    expect(missing).toEqual([])

    const carrying = triggers.filter((t) => t.name === "refuse_update").map((t) => t.table).sort()
    expect(carrying).toEqual([...APPEND_ONLY].sort())
    for (const table of APPEND_ONLY) expect(audited).toContain(table)
  })

  test("no trigger in the public schema is disabled", () => {
    expect(triggers.filter((t) => !enabled(t)).map((t) => `${t.table}.${t.name} (${t.enabled})`)).toEqual([])
    expect(triggers.filter((t) => t.name.startsWith("refuse_")).length).toBeGreaterThan(audited.length * 2)
  })
})
