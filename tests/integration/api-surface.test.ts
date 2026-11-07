import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { anonClient, signedIn } from "../support/db"
import { SEEDED_AGENT, SUPER_ADMIN } from "../support/fixtures"
import { FUNCTIONS, POLICIES, RELATIONS, type AgentAnswer, type ApiRole } from "./api-surface"

// The permanent security test (#188). It reads what the `anon` and
// `authenticated` API roles can actually reach in the exposed schemas,
// checks every item against the checked-in list in ./api-surface.ts, and has
// the seeded Marketing Agent call every function and read every table. An
// agent session gets nothing from any staff function or table.

const EXPOSED = ["public", "graphql_public"]
const PRIVILEGES = ["select", "insert", "update", "delete", "truncate", "references", "trigger", "maintain"]

let sql: Client

beforeAll(async () => {
  sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
})

afterAll(async () => {
  await sql?.end()
})

type CatalogFunction = { signature: string; schema: string; name: string; types: string[]; roles: ApiRole[] }

async function catalogFunctions(): Promise<CatalogFunction[]> {
  const { rows } = await sql.query<{ signature: string; schema: string; name: string; types: string[]; anon: boolean; authenticated: boolean }>(
    `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
       n.nspname as schema, p.proname as name, p.proargtypes::regtype[]::text[] as types,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = any ($1)
       and p.prorettype not in ('trigger'::regtype, 'event_trigger'::regtype)
       and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
     order by 1`,
    [EXPOSED],
  )
  return rows.map((row) => ({
    signature: row.signature,
    schema: row.schema,
    name: row.name,
    types: row.types,
    roles: [...(row.anon ? (["anon"] as const) : []), ...(row.authenticated ? (["authenticated"] as const) : [])],
  }))
}

// Calls `fn` with its entry's sample arguments as `role`, in a transaction
// that is rolled back. `authenticated` signs in as the seeded agent, or with
// `asStaff` as the Super Admin, who holds every permission (#237).
async function answer(fn: CatalogFunction, role: ApiRole, { asStaff = false } = {}): Promise<{ refused: string } | { returns: unknown[] }> {
  const entry = FUNCTIONS[fn.signature]
  const args = Object.values(entry.args)
  await sql.query("begin")
  try {
    if (entry.setup) {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(entry.setup)
      await sql.query("select set_config('audit.actor_kind', '', true), set_config('audit.actor_staff_id', '', true)")
    }
    const values = args.length
      ? Object.values((await sql.query(`select ${args.map((arg, i) => `(${arg})::text as a${i}`).join(", ")}`)).rows[0])
      : []
    let userId = SEEDED_AGENT.userId
    if (asStaff) {
      userId = SUPER_ADMIN.userId
      await sql.query("select public.set_audit_actor('staff', $1)", [SUPER_ADMIN.id])
    }
    const claims = role === "anon" ? { role: "anon" } : { sub: userId, role: "authenticated" }
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    await sql.query(`set local role ${role}`)
    const call = `${fn.schema}.${fn.name}(${fn.types.map((type, i) => `$${i + 1}::${type}`).join(", ")})`
    const { rows } = await sql.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as v from ${call} t`, values)
    return { returns: rows[0].v as unknown[] }
  } catch (error) {
    const { message, detail } = error as Error & { detail?: string }
    return { refused: asStaff && detail ? `${message} (${detail})` : message }
  } finally {
    await sql.query("rollback")
  }
}

function expectAnswer(signature: string, got: { refused: string } | { returns: unknown[] }, expected: AgentAnswer) {
  if ("anyAnswer" in expected) {
    expect("returns" in got, `${signature} should answer: ${JSON.stringify(got)}`).toBe(true)
    return
  }
  expect(got, signature).toEqual(expected)
}

// Counts the rows `role` can see in `relation`, signed in as the seeded agent
// for `authenticated`.
async function visibleRows(relation: string, role: ApiRole): Promise<number | string> {
  await sql.query("begin")
  try {
    const claims = role === "anon" ? { role: "anon" } : { sub: SEEDED_AGENT.userId, role: "authenticated" }
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    await sql.query(`set local role ${role}`)
    const { rows } = await sql.query<{ n: string }>(`select count(*) as n from ${relation}`)
    return Number(rows[0].n)
  } catch (error) {
    return (error as Error).message
  } finally {
    await sql.query("rollback")
  }
}

describe("the seeded agent", () => {
  test("is a signed-in agent principal, so the checks below test an agent", async () => {
    await sql.query("begin")
    try {
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: SEEDED_AGENT.userId, role: "authenticated" }),
      ])
      const { rows } = await sql.query("select kind, agent_id from public.current_principal()")
      expect(rows).toEqual([{ kind: "agent", agent_id: SEEDED_AGENT.id }])
    } finally {
      await sql.query("rollback")
    }
  })
})

describe("functions", () => {
  test("every function the API roles can execute is on the list, with exactly those roles", async () => {
    const catalog = await catalogFunctions()
    const unlisted = catalog.filter((fn) => !FUNCTIONS[fn.signature]).map((fn) => fn.signature)
    expect(unlisted, "add these to tests/integration/api-surface.ts").toEqual([])

    const stale = Object.keys(FUNCTIONS).filter((signature) => !catalog.some((fn) => fn.signature === signature))
    expect(stale, "remove these from tests/integration/api-surface.ts").toEqual([])

    for (const fn of catalog) expect(fn.roles, fn.signature).toEqual(FUNCTIONS[fn.signature].roles)
  })

  test("every entry names each argument the function takes, in order", async () => {
    const { rows } = await sql.query<{ signature: string; names: string[] | null; count: number }>(
      `select n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' as signature,
         p.proargnames[1:p.pronargs] as names, p.pronargs as count
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = any ($1)`,
      [EXPOSED],
    )
    for (const row of rows) {
      const entry = FUNCTIONS[row.signature]
      if (!entry) continue
      const expected = Array.from({ length: row.count }, (_, i) => row.names?.[i] || `$${i + 1}`)
      expect(Object.keys(entry.args), row.signature).toEqual(expected)
    }
  })

  test("no deprecated overload outlives its removal date", () => {
    const today = new Date().toISOString().slice(0, 10)
    const overdue = Object.entries(FUNCTIONS).filter(([, entry]) => entry.removeBy && entry.removeBy < today)
    expect(overdue.map(([signature, entry]) => `${signature}: remove by ${entry.removeBy}`)).toEqual([])
  })

  test("the seeded agent gets the recorded answer, which is nothing, from every function", async () => {
    for (const fn of await catalogFunctions()) {
      if (!fn.roles.includes("authenticated")) continue
      expectAnswer(fn.signature, await answer(fn, "authenticated"), FUNCTIONS[fn.signature].agent)
    }
  })

  // The refusals above prove something only if the call itself was valid: a
  // sample with a bad argument would be refused whoever asked. So each
  // signed-in sample must succeed for a staff member who holds every
  // permission.
  test("every sample is a call an authorised staff member can make", async () => {
    const failed: string[] = []
    for (const fn of await catalogFunctions()) {
      if (!fn.roles.includes("authenticated")) continue
      const got = await answer(fn, "authenticated", { asStaff: true })
      if ("refused" in got) failed.push(`${fn.signature}: ${got.refused}`)
    }
    expect(failed, "fix these sample arguments in tests/integration/api-surface.ts").toEqual([])
  })

  test("a visitor with no session gets the same nothing from every function open to them", async () => {
    for (const fn of await catalogFunctions()) {
      if (!fn.roles.includes("anon")) continue
      expectAnswer(fn.signature, await answer(fn, "anon"), FUNCTIONS[fn.signature].agent)
    }
  })
})

// Every column privilege an API role holds, directly, through PUBLIC or
// through a role it belongs to, beyond what it holds on the whole relation.
async function columnGrants(): Promise<{ name: string; role: string; privilege: string }[]> {
  const { rows } = await sql.query(
    `select n.nspname || '.' || c.relname || '.' || a.attname as name, r.role, p.privilege
     from pg_attribute a
     join pg_class c on c.oid = a.attrelid
     join pg_namespace n on n.oid = c.relnamespace
     cross join unnest(array['anon', 'authenticated']) r (role)
     cross join unnest(array['select', 'insert', 'update', 'references']) p (privilege)
     where n.nspname = any ($1) and c.relkind in ('r', 'v', 'm', 'p', 'f') and a.attnum > 0 and not a.attisdropped
       and has_column_privilege(r.role, c.oid, a.attnum, p.privilege)
       and not has_table_privilege(r.role, c.oid, p.privilege)
     order by 1, 2, 3`,
    [EXPOSED],
  )
  return rows
}

describe("tables and views", () => {
  test("every relation's privileges for the API roles are on the list", async () => {
    const { rows } = await sql.query<{ name: string; authenticated: string[]; anon: string[] }>(
      `select n.nspname || '.' || c.relname as name,
         array(select p from unnest($2::text[]) p where has_table_privilege('authenticated', c.oid, p)) as authenticated,
         array(select p from unnest($2::text[]) p where has_table_privilege('anon', c.oid, p)) as anon
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = any ($1) and c.relkind in ('r', 'v', 'm', 'p', 'f')
       order by 1`,
      [EXPOSED, PRIVILEGES],
    )
    expect(Object.fromEntries(rows.map((row) => [row.name, { authenticated: row.authenticated, anon: row.anon }]))).toEqual(RELATIONS)
  })

  test("every table has row security on, and no column is granted on its own", async () => {
    const { rows: open } = await sql.query(
      `select n.nspname || '.' || c.relname as name from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = any ($1) and c.relkind in ('r', 'p') and not c.relrowsecurity`,
      [EXPOSED],
    )
    expect(open).toEqual([])

    expect(await columnGrants()).toEqual([])
  })

  test("the column check finds a column grant an API role holds through another role", async () => {
    await sql.query("begin")
    try {
      await sql.query("create role api_surface_column_probe nologin")
      await sql.query("grant update (id) on public.leads to api_surface_column_probe")
      await sql.query("grant api_surface_column_probe to authenticated")
      expect(await columnGrants()).toEqual([{ name: "public.leads.id", role: "authenticated", privilege: "update" }])
    } finally {
      await sql.query("rollback")
    }
  })

  test("the seeded agent and a visitor see no row of any relation", async () => {
    for (const [relation, entry] of Object.entries(RELATIONS)) {
      if (entry.authenticated.includes("select")) expect(await visibleRows(relation, "authenticated"), relation).toBe(0)
      if (entry.anon.includes("select")) expect(await visibleRows(relation, "anon"), relation).toBe(0)
    }
  })

  test("through the API, the signed-in agent and a visitor read no rows", async () => {
    const agent = await signedIn(SEEDED_AGENT)
    const visitor = anonClient()
    for (const [relation, entry] of Object.entries(RELATIONS)) {
      const [schema, table] = relation.split(".")
      if (schema !== "public" || !entry.authenticated.includes("select")) continue
      const asAgent = await agent.from(table).select("*").limit(1)
      expect(asAgent.data ?? [], relation).toEqual([])
      const asVisitor = await visitor.from(table).select("*").limit(1)
      expect(asVisitor.data ?? [], relation).toEqual([])
    }
  })
})

describe("policies", () => {
  test("every policy is on the list, word for word", async () => {
    const { rows } = await sql.query<{ key: string; command: string; roles: string[]; using: string | null; check: string | null }>(
      `select schemaname || '.' || tablename || ': ' || policyname as key, cmd as command, roles::text[] as roles,
         qual as using, with_check as check
       from pg_policies where schemaname = any ($1) order by 1`,
      [EXPOSED],
    )
    expect(Object.fromEntries(rows.map(({ key, ...policy }) => [key, policy]))).toEqual(POLICIES)
  })

  test("every policy is gated on a base check that refuses an agent", () => {
    for (const [key, policy] of Object.entries(POLICIES)) {
      for (const expression of [policy.using, policy.check]) {
        if (expression === null) continue
        expect(expression, key).toMatch(/\b(has_permission|is_active_staff)\(/)
      }
    }
  })
})

// The Super Admin (#237) exists only through migrations. Named triggers, and
// the delete refusals every audited table has, refuse each change for every
// database role: the owner, the secret key's service_role and a signed-in
// session. Only a migration that disables a trigger by name can make one.
describe("the Super Admin's freeze", () => {
  const ROLE = SUPER_ADMIN.roleId
  const HOLDER = SUPER_ADMIN.id
  const MANAGER_ID = "a1a1a1a1-0000-4000-8000-000000000001"
  const REFUSALS: [string, string, string][] = [
    ["renaming the role", `update public.roles set name = 'Renamed' where id = '${ROLE}'`, "super_admin_frozen"],
    ["changing its permission set", `update public.roles set permissions = array['leads.view'] where id = '${ROLE}'`, "super_admin_frozen"],
    ["retiring it", `update public.roles set retired = true where id = '${ROLE}'`, "super_admin_frozen"],
    ["deleting it", `delete from public.roles where id = '${ROLE}'`, "delete_refused"],
    [
      "adding a second holder",
      `insert into public.staff_members (full_name, email, role_id) values ('Second Holder', 'second-holder@example.test', '${ROLE}')`,
      "super_admin_frozen",
    ],
    ["moving someone into the role", `update public.staff_members set role_id = '${ROLE}' where id = '${MANAGER_ID}'`, "super_admin_frozen"],
    [
      "moving the holder out of it",
      `update public.staff_members set role_id = (select id from public.roles where name = 'Admissions Manager') where id = '${HOLDER}'`,
      "super_admin_frozen",
    ],
    ["deactivating the holder", `update public.staff_members set active = false where id = '${HOLDER}'`, "super_admin_frozen"],
    ["renaming the holder", `update public.staff_members set full_name = 'Someone Else' where id = '${HOLDER}'`, "super_admin_frozen"],
    ["changing the holder's email", `update public.staff_members set email = 'other@example.test' where id = '${HOLDER}'`, "super_admin_frozen"],
    ["deleting the holder", `delete from public.staff_members where id = '${HOLDER}'`, "delete_refused"],
    ["giving a role audit.view", `update public.roles set permissions = permissions || array['audit.view'] where name = 'Admissions Manager'`, "audit_view_reserved"],
    ["creating a role with audit.view", "insert into public.roles (name, permissions) values ('Auditor', array['audit.view'])", "audit_view_reserved"],
  ]

  async function refusedAs(dbRole: "postgres" | "service_role", statement: string): Promise<string> {
    await sql.query("begin")
    try {
      await sql.query("select public.set_audit_actor('system')")
      if (dbRole === "service_role") await sql.query("set local role service_role")
      await sql.query(statement)
      return "accepted"
    } catch (error) {
      return (error as Error).message
    } finally {
      await sql.query("rollback")
    }
  }

  for (const [change, statement, code] of REFUSALS) {
    for (const dbRole of ["postgres", "service_role"] as const) {
      test(`${change} is refused for ${dbRole} with ${code}`, async () => {
        expect(await refusedAs(dbRole, statement)).toBe(code)
      })
    }
  }

  test("the holder still takes their first login and dismisses notices", async () => {
    await sql.query("begin")
    try {
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(`update public.staff_members set notices_seen_at = now() where id = '${HOLDER}'`)
      const { rows } = await sql.query(`select user_id from public.staff_members where id = '${HOLDER}'`)
      expect(rows[0].user_id).toBe(SUPER_ADMIN.userId)
      // A login already linked stays linked.
      await expect(sql.query(`update public.staff_members set user_id = null where id = '${HOLDER}'`)).rejects.toThrow("super_admin_frozen")
    } finally {
      await sql.query("rollback")
    }
  })
})
