import { Client } from "pg"
import { afterAll, beforeAll, describe, expect, test } from "vitest"

import { anonClient, signedIn } from "../support/db"
import { SEEDED_AGENT } from "../support/fixtures"
import { FUNCTIONS, POLICIES, RELATIONS, type AgentAnswer, type ApiRole } from "./api-surface"

// The permanent security test (#188). It reads what the `anon` and
// `authenticated` API roles can actually reach in the exposed schemas,
// checks every item against the checked-in list in ./api-surface.ts, and has
// the seeded Marketing Agent call every function and read every table. An
// agent session gets nothing from any staff function or table.

const EXPOSED = ["public", "graphql_public"]
const PRIVILEGES = ["select", "insert", "update", "delete", "truncate", "references", "trigger"]

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

// Calls `fn` with its entry's sample arguments as `role`, signed in as the
// seeded agent for `authenticated`, in a transaction that is rolled back.
async function answer(fn: CatalogFunction, role: ApiRole): Promise<{ refused: string } | { returns: unknown[] }> {
  const entry = FUNCTIONS[fn.signature]
  const args = Object.values(entry.args)
  await sql.query("begin")
  try {
    const values = args.length
      ? Object.values((await sql.query(`select ${args.map((arg, i) => `(${arg})::text as a${i}`).join(", ")}`)).rows[0])
      : []
    const claims = role === "anon" ? { role: "anon" } : { sub: SEEDED_AGENT.userId, role: "authenticated" }
    await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)])
    await sql.query(`set local role ${role}`)
    const call = `${fn.schema}.${fn.name}(${fn.types.map((type, i) => `$${i + 1}::${type}`).join(", ")})`
    const { rows } = await sql.query(`select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as v from ${call} t`, values)
    return { returns: rows[0].v as unknown[] }
  } catch (error) {
    return { refused: (error as Error).message }
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

  test("a visitor with no session gets the same nothing from every function open to them", async () => {
    for (const fn of await catalogFunctions()) {
      if (!fn.roles.includes("anon")) continue
      expectAnswer(fn.signature, await answer(fn, "anon"), FUNCTIONS[fn.signature].agent)
    }
  })
})

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

    const { rows: columns } = await sql.query(
      `select n.nspname || '.' || c.relname || '.' || a.attname as name
       from pg_attribute a
       join pg_class c on c.oid = a.attrelid
       join pg_namespace n on n.oid = c.relnamespace
       cross join lateral aclexplode(a.attacl) acl
       where n.nspname = any ($1) and acl.grantee in (0, 'anon'::regrole, 'authenticated'::regrole)`,
      [EXPOSED],
    )
    expect(columns).toEqual([])
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
