import { Client } from "pg"

import type { FixtureStaff } from "./fixtures"

// Agent fixtures that leave the Pending count alone. Registering an agent and
// approving them through the API commits a Pending agent for a moment, and a
// test running alongside that compares Pending counts can see it come and go.
// Here both happen in one transaction, so no other session ever sees the
// agent Pending.

// Sets the session the database functions read through auth.role() and
// auth.uid(), as PostgREST does for a request.
async function claims(sql: Client, value: object) {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(value)])
}

// Registers an agent as the public form's server does, and approves them as
// `approver` (who needs agents.approve), in one committed transaction. Returns
// the new record's id and code.
export async function registerApprovedAgent(
  approver: FixtureStaff,
  agent: { fullName: string; phone: string },
): Promise<{ id: string; code: string }> {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    await claims(sql, { role: "service_role" })
    const code = (
      await sql.query<{ code: string }>("select public.register_marketing_agent($1, $2, null) as code", [agent.fullName, agent.phone])
    ).rows[0].code
    const { rows } = await sql.query<{ id: string; user_id: string }>(
      "select a.id, s.user_id from public.marketing_agents a, public.staff_members s where a.code = $1 and a.retired_at is null and s.id = $2",
      [code, approver.id],
    )
    await claims(sql, { sub: rows[0].user_id, role: "authenticated" })
    await sql.query("select public.approve_marketing_agent($1)", [rows[0].id])
    await sql.query("commit")
    return { id: rows[0].id, code }
  } catch (error) {
    await sql.query("rollback").catch(() => {})
    throw error
  } finally {
    await sql.end()
  }
}

// The Pending count as `staff` reads it (getPendingAgentCount's query: Pending
// agents not retired, under the table's row security), before and after
// `change` runs as the database owner. Both reads and the change share one
// repeatable-read transaction that is rolled back, so agents that tests
// running alongside register, approve or retire can't move the numbers, and
// nothing `change` does outlives the call.
export async function pendingAround(
  staff: FixtureStaff,
  change: (sql: Client) => Promise<unknown>,
): Promise<{ before: number; after: number }> {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin isolation level repeatable read")
    const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staff.id])
    const read = async () => {
      await claims(sql, { sub: rows[0].user_id, role: "authenticated" })
      await sql.query("set local role authenticated")
      const counted = await sql.query<{ n: string }>(
        "select count(*) as n from public.marketing_agents where status = 'Pending' and retired_at is null",
      )
      await sql.query("reset role")
      await sql.query("select set_config('request.jwt.claims', '', true)")
      return Number(counted.rows[0].n)
    }
    const before = await read()
    await sql.query("select public.set_audit_actor('system')")
    await change(sql)
    const after = await read()
    return { before, after }
  } finally {
    await sql.query("rollback").catch(() => {})
    await sql.end()
  }
}
