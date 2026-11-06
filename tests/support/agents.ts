import { Client } from "pg"

import type { FixtureStaff } from "./fixtures"

// Agent fixtures for the tests. Each makes its agent as the database owner
// through create_agent_record, the shared creation function behind the
// Manager's Create agent and the Discount code page's sign-up, with the
// Admission form as the actor, so the record is one the public path makes:
// Pending, with a code of the name's initials, and no email. The public
// registration function the fixtures once called, register_marketing_agent,
// is gone (#196); the page now signs agents up with an email through
// sign_up_marketing_agent, tested in tests/integration/agent-email-claims.test.ts.

// Sets the session the database functions read through auth.role() and
// auth.uid(), as PostgREST does for a request.
async function claims(sql: Client, value: object) {
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(value)])
}

export type NewAgentFixture = { fullName: string; phone: string; whatsapp?: string | null }

// Makes a Pending agent in `sql`'s transaction and returns the record's id
// and code. A phone a current agent already holds returns that agent, as
// public registration always has, so a retry never makes a second agent.
async function createPending(sql: Client, agent: NewAgentFixture): Promise<{ id: string; code: string }> {
  await claims(sql, { role: "service_role" })
  await sql.query("select public.set_audit_actor('public_form', null)")
  // Two statements: a row the function inserts isn't visible to a scan in the
  // same statement.
  const made = await sql.query<{ id: string | null }>(
    "select coalesce(agent_id, existing_agent) as id from public.create_agent_record($1, $2, $3, null, null, 'Pending', null)",
    [agent.fullName, agent.phone, agent.whatsapp ?? null],
  )
  const id = made.rows[0]?.id
  if (!id) throw new Error(`could not make an agent for ${agent.fullName}`)
  const { rows } = await sql.query<{ id: string; code: string }>("select a.id, a.code from public.marketing_agents a where a.id = $1", [id])
  return rows[0]
}

// A Pending agent of the test's own, committed. Returns the record's id and
// code.
export async function registerPendingAgent(agent: NewAgentFixture): Promise<{ id: string; code: string }> {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    const made = await createPending(sql, agent)
    await sql.query("commit")
    return made
  } catch (error) {
    await sql.query("rollback").catch(() => {})
    throw error
  } finally {
    await sql.end()
  }
}

// An agent registered and approved as `approver` (who needs agents.approve)
// in one committed transaction, so no other session ever sees the agent
// Pending: a test running alongside that compares Pending counts can't see
// it come and go. Returns the new record's id and code.
export async function registerApprovedAgent(
  approver: FixtureStaff,
  agent: { fullName: string; phone: string },
): Promise<{ id: string; code: string }> {
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    const { id, code } = await createPending(sql, agent)
    const { rows } = await sql.query<{ user_id: string }>("select s.user_id from public.staff_members s where s.id = $1", [approver.id])
    await claims(sql, { sub: rows[0].user_id, role: "authenticated" })
    await sql.query("select public.approve_marketing_agent($1)", [id])
    await sql.query("commit")
    return { id, code }
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
