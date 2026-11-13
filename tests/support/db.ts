import { randomInt, randomUUID } from "node:crypto"
import { isDeepStrictEqual } from "node:util"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { Client } from "pg"

import type { FixtureStaff } from "./fixtures"

// The three doors into local Supabase that the database tests use:
//   - the publishable key, the same access any visitor's browser has;
//   - the secret key, what a server-side service would hold;
//   - SQL as the database owner, what a migration or the SQL editor runs as.

function required(name: string) {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} must be set in .env.local for the database tests. See .env.example.`)
  }
  return value
}

const options = { auth: { persistSession: false, autoRefreshToken: false } }

// Local Supabase runs CAPTCHA protection with Cloudflare's always-pass test
// secret (supabase/config.toml, #268), so a publishable-key call to /token
// (password), /signup, /recover, /otp, /magiclink or /resend needs a token.
// This is Cloudflare's dummy token, which that secret accepts.
export const TEST_CAPTCHA_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"

export function anonClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), options)
}

export function secretClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), options)
}

export async function signedIn(person: { email: string; password: string }): Promise<SupabaseClient> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({
    email: person.email,
    password: person.password,
    options: { captchaToken: TEST_CAPTCHA_TOKEN },
  })
  if (error) throw new Error(`Could not sign in ${person.email}: ${error.message}`)
  return client
}

// Runs `work` in a transaction on a direct database connection, then rolls it
// back so nothing it did outlives the test.
export async function inRolledBackTransaction<T>(work: (sql: Client) => Promise<T>): Promise<T> {
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    await sql.query("begin")
    return await work(sql)
  } finally {
    await sql.query("rollback").catch(() => {})
    await sql.end()
  }
}

// Runs `work` in one repeatable-read transaction that is rolled back. Every
// statement in it sees the database as it was at the first one, whatever
// tests running alongside commit meanwhile, so reads taken one after another
// agree without locking a table. A write that meets a row another test
// changed since fails with 40001 (serialization_failure); `work` then runs
// again from the start, so it must have no effect outside the transaction.
export async function inOneSnapshot<T>(work: (sql: Client) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await inRolledBackTransaction(async (sql) => {
        await sql.query("set transaction isolation level repeatable read")
        return work(sql)
      })
    } catch (error) {
      if ((error as { code?: string }).code !== "40001" || attempt >= 10) throw error
    }
  }
}

// Acts as `staffId`'s signed-in session for the rest of `sql`'s transaction,
// the way the API would, so reads and calls follow the same row-level
// security and permission checks.
export async function actAsStaff(sql: Client, staffId: string): Promise<void> {
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
  if (!rows[0]) throw new Error(`No staff member ${staffId}`)
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  await sql.query("set local role authenticated")
}

// Runs `work` between two reads of `state`, and returns both once the two
// reads agree: nothing `state` covers changed while `work` ran. A test that
// compares a service's answer, read through the API, with the database's own
// uses this instead of locking the table against tests running alongside.
// Make `state` exact, such as the ids and xmin of the rows a count covers
// (a row's xmin changes with every committed write to it). Keep assertions
// out of `work`: when the reads differ, `work` runs again.
export async function whileUnchanged<S, T>(
  state: (sql: Client) => Promise<S>,
  work: (before: S) => Promise<T>,
  { tries = 50 }: { tries?: number } = {},
): Promise<{ state: S; result: T }> {
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    for (let attempt = 1; attempt <= tries; attempt++) {
      const before = await state(sql)
      const result = await work(before)
      if (isDeepStrictEqual(before, await state(sql))) return { state: before, result }
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 80))
    }
    throw new Error(`The rows kept changing, ${tries} times`)
  } finally {
    await sql.end()
  }
}

// Runs one statement inside `sql`'s transaction without ever waiting on a
// lock while holding another. A statement that takes several heavy locks in
// turn, like `truncate ... cascade`, or that updates rows other tests use,
// can otherwise deadlock with a test that already holds one of them. It gives
// up a lock wait well before Postgres checks for deadlocks, releases what it
// took and tries again.
export async function withoutLockWaits(sql: Client, query: string, params: unknown[] = []): Promise<void> {
  const { rows } = await sql.query<{ setting: string }>("select current_setting('lock_timeout') as setting")
  for (;;) {
    await sql.query("savepoint without_lock_waits")
    try {
      await sql.query("set local lock_timeout = '50ms'")
      await sql.query(query, params)
      // The rest of the transaction waits as long as it did before.
      await sql.query("select set_config('lock_timeout', $1, true)", [rows[0].setting])
      await sql.query("release savepoint without_lock_waits")
      return
    } catch (error) {
      // 55P03: lock_not_available, raised when lock_timeout runs out.
      if ((error as { code?: string }).code !== "55P03") throw error
      await sql.query("rollback to savepoint without_lock_waits")
      await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 80))
    }
  }
}

// Runs `work` in a transaction that commits, as the system actor.
// An Admission Number no lead holds yet. Numbers are random and the local
// database keeps every lead the tests make, so no fixed number stays free.
export async function unusedAdmissionNumber(): Promise<string> {
  return inRolledBackTransaction(async (sql) => {
    for (;;) {
      const number = `ADMSN-${String(randomInt(0, 100_000)).padStart(5, "0")}`
      const taken = await sql.query("select 1 from public.leads where admission_number = $1", [number])
      if (taken.rowCount === 0) return number
    }
  })
}

export function asSystem<T>(work: (sql: Client) => Promise<T>): Promise<T> {
  return committedAs("select public.set_audit_actor('system')", [], work)
}

// Runs `work` in a transaction that commits, naming a staff member as the
// actor: a write they made themselves, outside the screen's guardrails.
export function asStaffActor<T>(staffId: string, work: (sql: Client) => Promise<T>): Promise<T> {
  return committedAs("select public.set_audit_actor('staff', $1)", [staffId], work)
}

async function committedAs<T>(setActor: string, params: unknown[], work: (sql: Client) => Promise<T>): Promise<T> {
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    await sql.query("begin")
    await sql.query(setActor, params)
    const result = await work(sql)
    await sql.query("commit")
    return result
  } catch (error) {
    await sql.query("rollback").catch(() => {})
    throw error
  } finally {
    await sql.end()
  }
}

// A staff member of their own, on a role of their own, for a test that
// changes them. With `onRole`, they join that existing role instead, so a
// test can put someone inside or outside a managed set (#241). Staff rows are
// never deleted, so each run adds new ones; `npm run db:reset` clears them.
export async function createThrowawayStaff(
  permissions: string[],
  { onRole }: { onRole?: string } = {},
): Promise<FixtureStaff & { roleId: string }> {
  const suffix = randomUUID().slice(0, 8)
  const email = `throwaway-${suffix}@example.test`
  const password = "fixture-password"

  const { id, roleId, roleName } = await asSystem(async (sql) => {
    const role = onRole
      ? await sql.query<{ id: string; name: string }>("select id, name from public.roles where id = $1", [onRole])
      : await sql.query<{ id: string; name: string }>(
          "insert into public.roles (name, permissions) values ($1, $2) returning id, name",
          [`Throwaway role ${suffix}`, permissions],
        )
    const member = await sql.query<{ id: string }>(
      "insert into public.staff_members (full_name, email, role_id) values ($1, $2, $3) returning id",
      [`Throwaway ${suffix}`, email, role.rows[0].id],
    )
    return { id: member.rows[0].id, roleId: role.rows[0].id, roleName: role.rows[0].name }
  })

  const { error } = await secretClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`Could not create the account for ${email}: ${error.message}`)

  return { id, roleId, name: `Throwaway ${suffix}`, email, roleName, password }
}
