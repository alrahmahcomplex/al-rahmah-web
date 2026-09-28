import { randomUUID } from "node:crypto"

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

export function anonClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), options)
}

export function secretClient(): SupabaseClient {
  return createClient(required("NEXT_PUBLIC_SUPABASE_URL"), required("SUPABASE_SECRET_KEY"), options)
}

export async function signedIn(person: { email: string; password: string }): Promise<SupabaseClient> {
  const client = anonClient()
  const { error } = await client.auth.signInWithPassword({ email: person.email, password: person.password })
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

// Runs `work` in a transaction that commits, as the system actor.
export async function asSystem<T>(work: (sql: Client) => Promise<T>): Promise<T> {
  const sql = new Client({ connectionString: required("SUPABASE_DB_URL") })
  await sql.connect()
  try {
    await sql.query("begin")
    await sql.query("select public.set_audit_actor('system')")
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
// changes them. Staff rows are never deleted, so each run adds new ones;
// `npm run db:reset` clears them.
export async function createThrowawayStaff(permissions: string[]): Promise<FixtureStaff & { roleId: string }> {
  const suffix = randomUUID().slice(0, 8)
  const email = `throwaway-${suffix}@example.test`
  const password = "fixture-password"

  const { id, roleId } = await asSystem(async (sql) => {
    const role = await sql.query<{ id: string }>(
      "insert into public.roles (name, permissions) values ($1, $2) returning id",
      [`Throwaway role ${suffix}`, permissions],
    )
    const member = await sql.query<{ id: string }>(
      "insert into public.staff_members (full_name, email, role_id) values ($1, $2, $3) returning id",
      [`Throwaway ${suffix}`, email, role.rows[0].id],
    )
    return { id: member.rows[0].id, roleId: role.rows[0].id }
  })

  const { error } = await secretClient().auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`Could not create the account for ${email}: ${error.message}`)

  return { id, roleId, name: `Throwaway ${suffix}`, email, roleName: `Throwaway role ${suffix}`, password }
}
