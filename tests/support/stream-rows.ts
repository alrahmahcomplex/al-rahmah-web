import { Client } from "pg"

import { asSystem } from "./db"

// What the streams tests and the browser specs share, without the test
// runner: this file imports neither Vitest nor Playwright.

/**
 * The classes among `among` where nobody holds a seat in `year` yet. Local
 * databases keep every committed lead and fee test years are reused, so a
 * test that counts seats takes its classes from these.
 */
export async function classesWithoutSeatHolders(year: number, among: string[]): Promise<string[]> {
  const { rows } = await asSystem((sql) =>
    sql.query<{ class_name: string }>("select distinct class_name::text from public.seat_holders($1)", [year]),
  )
  const taken = new Set(rows.map((r) => r.class_name))
  return among.filter((c) => !taken.has(c))
}

/**
 * Removes the streams a test committed in `years`, with their placements,
 * requests and queued retries, so a later test that claims one of the years
 * finds no seat limit there. Streams refuse deletes; the replica role skips
 * the refusal triggers for this one transaction, without altering a table.
 */
export async function removeStreams(years: number[]): Promise<void> {
  if (years.length === 0) return
  const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
  await sql.connect()
  try {
    await sql.query("begin")
    // Every writer of these rows holds the seat lock.
    await sql.query("select public.seat_lock()")
    await sql.query("set local session_replication_role = replica")
    await sql.query(
      `delete from public.seat_placements p
       where p.waiting_year = any ($1) or p.stream_id in (select s.id from public.streams s where s.enrollment_year = any ($1))`,
      [years],
    )
    await sql.query("delete from public.seat_sync_queue q where q.retry and q.retry_year = any ($1)", [years])
    await sql.query("delete from public.stream_requests r where r.enrollment_year = any ($1)", [years])
    await sql.query("delete from public.streams s where s.enrollment_year = any ($1)", [years])
    await sql.query("commit")
  } catch (error) {
    await sql.query("rollback").catch(() => {})
    throw error
  } finally {
    await sql.end()
  }
}
