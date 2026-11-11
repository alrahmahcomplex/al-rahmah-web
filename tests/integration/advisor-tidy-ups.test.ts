import { readFileSync } from "node:fs"

import type { Client } from "pg"
import { describe, expect, test } from "vitest"

import { createThrowawayStaff, inRolledBackTransaction } from "../support/db"
import { MANAGER } from "../support/fixtures"

// What #287's migration leaves behind, read the way Supabase's advisors read
// the schema, plus its import_batches read rule and its hosted-only grant step.

const FILE = "supabase/migrations/20261208990100_advisor_tidy_ups.sql"

// Foreign keys left without an index on purpose (#287): two single-row
// tables, a table only migrations write, and a column a check ties to one
// that already leads an index.
const ACCEPTED_UNINDEXED = [
  "agent_access_settings.changed_by",
  "agent_status_changes.old_agent_id",
  "audit_action_kinds.permission",
  "interview_discount_setting.updated_by",
]

describe("the schema as the advisors read it", () => {
  test("only the four accepted foreign keys lack a covering index", async () => {
    const rows = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ fk: string }>(`
        select c.conrelid::regclass::text || '.' || string_agg(a.attname, ',' order by k.ord) as fk
        from pg_constraint c
        cross join lateral unnest(c.conkey) with ordinality k(attnum, ord)
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where c.contype = 'f'
          and c.connamespace = 'public'::regnamespace
          and not exists (
            select 1 from pg_index i
            where i.indrelid = c.conrelid
              and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
              and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
          )
        group by c.oid, c.conrelid
        order by 1`)
      return rows.map((row) => row.fk.replace(/^public\./, ""))
    })
    expect(rows).toEqual(ACCEPTED_UNINDEXED)
  })

  test("every public table has a primary key", async () => {
    const missing = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ name: string }>(`
        select c.relname as name
        from pg_class c
        where c.relnamespace = 'public'::regnamespace
          and c.relkind in ('r', 'p')
          and not exists (select 1 from pg_constraint p where p.conrelid = c.oid and p.contype = 'p')`)
      return rows.map((row) => row.name)
    })
    expect(missing).toEqual([])
  })

  test("no table has two permissive policies for the same command and role", async () => {
    const doubled = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ entry: string }>(`
        select tablename || ' ' || cmd || ' ' || role as entry
        from pg_policies, unnest(roles) role
        where schemaname = 'public' and permissive = 'PERMISSIVE'
        group by tablename, cmd, role
        having count(*) > 1`)
      return rows.map((row) => row.entry)
    })
    expect(doubled).toEqual([])
  })
})

describe("the migration's indexes and key", () => {
  // The migration's section between two of its headings, as written in the file.
  function section(from: string, to: string) {
    const text = readFileSync(FILE, "utf8")
    const start = text.indexOf(from)
    const end = text.indexOf(to, start)
    if (start < 0 || end < 0) throw new Error(`${FILE}: no section from "${from}" to "${to}"`)
    return text.slice(start, end)
  }

  test("the actor index carries the history screen's order", async () => {
    const definition = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ def: string }>("select pg_get_indexdef('public.audit_log_actor_staff_id_idx'::regclass) as def")
      return rows[0].def
    })
    expect(definition).toBe(
      "CREATE INDEX audit_log_actor_staff_id_idx ON public.audit_log USING btree (actor_staff_id, created_at DESC, id DESC) WHERE (actor_staff_id IS NOT NULL)",
    )
  })

  test("the agent_link_requests key goes on even when two identical rows are there", async () => {
    const result = await inRolledBackTransaction(async (sql) => {
      // Back to the table as it was before the migration, holding a duplicate.
      await sql.query("alter table public.agent_link_requests drop constraint agent_link_requests_pkey")
      await sql.query("create index agent_link_requests_email_idx on public.agent_link_requests (email_hash, requested_at)")
      const hash = "a".repeat(64)
      await sql.query(
        `insert into public.agent_link_requests (email_hash, requested_at)
         values ($1, '2026-11-11 10:00:00+00'), ($1, '2026-11-11 10:00:00+00'), ($1, '2026-11-11 10:00:01+00')`,
        [hash],
      )
      await sql.query(section("-- 2. agent_link_requests: a primary key", "-- 3. import_batches: one read policy"))
      const { rows } = await sql.query<{ n: string }>("select count(*) as n from public.agent_link_requests where email_hash = $1", [hash])
      const { rows: key } = await sql.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'agent_link_requests_pkey'",
      )
      const { rows: old } = await sql.query<{ name: string | null }>("select to_regclass('public.agent_link_requests_email_idx')::text as name")
      return { rows: Number(rows[0].n), key: key[0]?.def, old: old[0].name }
    })
    expect(result).toEqual({ rows: 2, key: "PRIMARY KEY (email_hash, requested_at)", old: null })
  })
})

describe("reading import_batches", () => {
  async function insertBatches(sql: Client): Promise<string[]> {
    await sql.query("select public.set_audit_actor('system')")
    const { rows } = await sql.query<{ id: string }>(
      `insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
       values ('agents', 'agents.xlsx', $1, 1, 1, 0, 0), ('students', 'students.xlsx', $1, 1, 1, 0, 0)
       returning id`,
      [MANAGER.id],
    )
    return rows.map((row) => row.id)
  }

  async function visibleTo(sql: Client, role: "authenticated" | "anon", userId: string | null, ids: string[]) {
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: userId, role })])
    await sql.query(`set local role ${role}`)
    try {
      const { rows } = await sql.query<{ kind: string }>("select kind from public.import_batches where id = any ($1) order by kind", [ids])
      return rows.map((row) => row.kind)
    } finally {
      await sql.query("reset role")
    }
  }

  async function userIdOf(sql: Client, staffId: string) {
    const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
    return rows[0].user_id
  }

  test("staff with leads.view read both kinds", async () => {
    const kinds = await inRolledBackTransaction(async (sql) => {
      const ids = await insertBatches(sql)
      return visibleTo(sql, "authenticated", await userIdOf(sql, MANAGER.id), ids)
    })
    expect(kinds).toEqual(["agents", "students"])
  })

  test("staff whose role lacks leads.view, and visitors not signed in, read none", async () => {
    const staff = await createThrowawayStaff([])
    const seen = await inRolledBackTransaction(async (sql) => {
      const ids = await insertBatches(sql)
      return {
        staff: await visibleTo(sql, "authenticated", await userIdOf(sql, staff.id), ids),
        visitor: await visibleTo(sql, "anon", null, ids),
      }
    })
    expect(seen).toEqual({ staff: [], visitor: [] })
  })
})

describe("the rls_auto_enable() step", () => {
  // The migration's guarded block, as written in the file.
  function guardedBlock() {
    const match = /^do \$\$\nbegin\n {4}if to_regprocedure\('public\.rls_auto_enable\(\)'\)[\s\S]*?^\$\$;$/m.exec(readFileSync(FILE, "utf8"))
    if (!match) throw new Error(`${FILE}: the rls_auto_enable() block is missing`)
    return match[0]
  }

  // A stand-in of the hosted function's shape: an event-trigger function that
  // marks the transaction when it fires.
  async function createStandIn(sql: Client) {
    await sql.query(`
      create function public.rls_auto_enable() returns event_trigger language plpgsql as $$
      begin
        perform set_config('advisor_test.fired', 'yes', true);
      end;
      $$`)
    await sql.query("create event trigger advisor_test_ensure_rls on ddl_command_end execute function public.rls_auto_enable()")
  }

  async function canExecute(sql: Client, role: string) {
    const { rows } = await sql.query<{ allowed: boolean }>("select has_function_privilege($1, 'public.rls_auto_enable()', 'execute') as allowed", [role])
    return rows[0].allowed
  }

  test("does nothing where the function doesn't exist", async () => {
    await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ fn: string | null }>("select to_regprocedure('public.rls_auto_enable()')::text as fn")
      expect(rows[0].fn).toBeNull()
      await sql.query(guardedBlock())
    })
  })

  test("takes execute from public, anon and authenticated, and the event trigger still fires", async () => {
    const result = await inRolledBackTransaction(async (sql) => {
      await createStandIn(sql)
      const before = { anon: await canExecute(sql, "anon"), authenticated: await canExecute(sql, "authenticated") }
      await sql.query(guardedBlock())
      const after = {
        anon: await canExecute(sql, "anon"),
        authenticated: await canExecute(sql, "authenticated"),
        service_role: await canExecute(sql, "service_role"),
      }
      await sql.query("create table public.advisor_test_table (id int primary key)")
      const { rows } = await sql.query<{ fired: string | null }>("select current_setting('advisor_test.fired', true) as fired")
      return { before, after, fired: rows[0].fired }
    })
    expect(result).toEqual({
      before: { anon: true, authenticated: true },
      after: { anon: false, authenticated: false, service_role: true },
      fired: "yes",
    })
  })

  test("a role with no rights on the function runs the block without failing", async () => {
    const after = await inRolledBackTransaction(async (sql) => {
      await createStandIn(sql)
      await sql.query("revoke execute on function public.rls_auto_enable() from public, anon")
      await sql.query("set local role anon")
      await sql.query(guardedBlock())
      await sql.query("reset role")
      return { authenticated: await canExecute(sql, "authenticated") }
    })
    // The revoke was refused and caught, so nothing changed.
    expect(after).toEqual({ authenticated: true })
  })
})
