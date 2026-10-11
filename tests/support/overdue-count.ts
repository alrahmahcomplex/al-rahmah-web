import type { Client } from "pg"

import { inRolledBackTransaction } from "./db"

// The Follow-ups queue's Overdue count, read where tests running alongside
// can't move it. Other test files plant overdue follow-ups all the time, so a
// count read through the API before and after a change can drift by more than
// the change. Here both reads, and the change between them, happen in one
// repeatable-read transaction that is rolled back afterwards: the count sees
// only this test's change.

export type OverdueSnapshot = {
  // follow_up_overdue_count(), as the staff member reads it.
  count: number
  // The total follow_up_queue('overdue', 1) reports on its rows.
  total: number
}

// Acts as `staffId`'s signed-in session, the way the API would.
async function asStaff(sql: Client, staffId: string) {
  const { rows } = await sql.query<{ user_id: string }>("select user_id from public.staff_members where id = $1", [staffId])
  await sql.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: rows[0].user_id, role: "authenticated" })])
  await sql.query("set local role authenticated")
}

async function asOwner(sql: Client) {
  await sql.query("reset role")
  await sql.query("select set_config('request.jwt.claims', '', true)")
}

async function read(sql: Client, staffId: string): Promise<OverdueSnapshot> {
  await asStaff(sql, staffId)
  const { rows } = await sql.query<{ count: string; total: string | null }>(
    "select public.follow_up_overdue_count() as count, (select q.total from public.follow_up_queue('overdue', 1) q limit 1) as total",
  )
  await asOwner(sql)
  return { count: Number(rows[0].count), total: Number(rows[0].total ?? 0) }
}

// The Overdue count and total as `staffId` reads them, before and after
// `change` runs as the database owner, with the system as the audit actor.
// Nothing `change` does outlives the call.
export async function overdueAround(
  staffId: string,
  change: (sql: Client) => Promise<unknown>,
): Promise<{ before: OverdueSnapshot; after: OverdueSnapshot }> {
  return inRolledBackTransaction(async (sql) => {
    await sql.query("set transaction isolation level repeatable read")
    const before = await read(sql, staffId)
    await sql.query("select public.set_audit_actor('system')")
    await change(sql)
    const after = await read(sql, staffId)
    return { before, after }
  })
}
