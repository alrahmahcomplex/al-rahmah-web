import { Client } from "pg"
import { beforeAll, describe, expect, test, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { declineLead, markLead } from "@/lib/services/lead-closure"

import { actAsStaff, asSystem, inRolledBackTransaction, signedIn, unusedAdmissionNumber } from "../../support/db"
import { MANAGER } from "../../support/fixtures"
import { child, holder, refusal, streamYears } from "../../support/streams"

// The activation migration's dry run (#449, slice 6; brief section 8).
// 20270113100100 moved the school's seats into streams once, by calling
// activate_streams(). This runs the same function again on data shaped like
// the school's, inside a transaction that is rolled back: the seat mode is
// put back to `legacy`, every stream and placement is taken away, a claimed
// fee year gets seats per class and Day or Boarding as they were set before
// streams, and the function moves them.
//
// It runs in integration-serial, alone: the function reads every lead and
// places children in every class with seats, the seeded years' included, and
// a child whose row another test held would be skipped, which the function
// refuses. It takes no table lock: the migration's own `do` block does, and
// nothing runs beside this file.
//
// The classes of the fixture year, as class_seats has them before the move:
//
//   both      Day 2, Boarding 1    three holders: Day, Boarding, and an
//                                  Archived one, who keeps the seat
//   daySet    Day 2 only           two holders, one of them a Boarding child
//   over      Day 1, Boarding 1    four holders, one with no Boy or girl
//                                  answer; a Declined child who paid; a child
//                                  below the deposit; an Enrolled imported
//                                  child with no payment
//   zeroBoth  Day 0, Boarding 0    one holder
//   zeroOne   Day 0, Boarding 2    one holder
//   zeroUnset Boarding 0 only      one holder: the class gets no stream and
//                                  keeps no limit (the lead's decision of
//                                  2026-11-19, from the owner's Q17)
//   notSet    no seats             one holder

const yearAndClasses = streamYears()

type ClassReport = {
  year: number
  class: string
  day_seats: number | null
  boarding_seats: number | null
  seats: number
  seat_holders: number
  placed: number
  waiting: number
}
type Report = {
  ticket: string
  streams_created: number
  children_placed: number
  children_waiting: number
  classes_with_one_of_day_and_boarding_set: number
  classes_at_0_on_both_sides: number
  classes_at_0_on_one_side_only: number
  classes_at_0_with_other_side_not_set: number
  classes_left_with_no_stream: { year: number; class: string; day_seats: number | null; boarding_seats: number | null; seat_holders: number }[]
  classes: ClassReport[]
}

let year: number
let both: string, daySet: string, over: string, zeroBoth: string, zeroOne: string, zeroUnset: string, notSet: string
const lead: Record<string, string> = {}
// For the Enrolled imported child each run makes inside its transaction.
let importedNumber: string

beforeAll(async () => {
  importedNumber = await unusedAdmissionNumber()
  const claimed = await yearAndClasses(7)
  year = claimed.year
  ;[both, daySet, over, zeroBoth, zeroOne, zeroUnset, notSet] = claimed.classes
  const manager = await signedIn(MANAGER)

  lead.bothDay = await holder(year, both, "Boy", 9)
  lead.bothBoarding = await holder(year, both, "Girl", 8, { dayOrBoarding: "Boarding" })
  lead.bothArchived = await holder(year, both, "Girl", 7)
  const archived = await markLead(manager, lead.bothArchived, { mark: "archived", reason: "Admission cycle ended" })
  if (!archived.ok) throw new Error(`archive failed: ${archived.error}`)

  lead.daySetDay = await holder(year, daySet, "Boy", 6)
  lead.daySetBoarding = await holder(year, daySet, "Girl", 5, { dayOrBoarding: "Boarding" })

  // Ranked: the Full child first, then the Deposit children, oldest first.
  lead.overDepositOldNoAnswer = await holder(year, over, undefined, 9)
  lead.overDepositMiddle = await holder(year, over, "Girl", 5, { dayOrBoarding: "Boarding" })
  lead.overFull = await holder(year, over, "Boy", 1, { payment: { type: "full_payment", amount: 5_000_000 } })
  lead.overDepositLate = await holder(year, over, "Boy", 2)
  lead.overDeclined = await holder(year, over, "Girl", 20)
  const declined = await declineLead(manager, lead.overDeclined, { reason: "Fee payment not completed" })
  if (!declined.ok) throw new Error(`decline failed: ${declined.error}`)
  // Below the deposit: no Seat priority, so no seat.
  lead.overBelowDeposit = await holder(year, over, "Boy", 3, { payment: { amount: 100_000 } })

  lead.zeroBoth = await holder(year, zeroBoth, "Boy", 4)
  lead.zeroOne = await holder(year, zeroOne, "Girl", 4)
  lead.zeroUnset = await holder(year, zeroUnset, "Girl", 4)
  lead.notSet = await holder(year, notSet, "Boy", 4)
  // A child with no payment at all.
  lead.noPayment = await child(year, both, "Girl")
}, 300_000)

const SEATS: () => [string, "Day" | "Boarding", number][] = () => [
  [both, "Day", 2],
  [both, "Boarding", 1],
  [daySet, "Day", 2],
  [over, "Day", 1],
  [over, "Boarding", 1],
  [zeroBoth, "Day", 0],
  [zeroBoth, "Boarding", 0],
  [zeroOne, "Day", 0],
  [zeroOne, "Boarding", 2],
  [zeroUnset, "Boarding", 0],
]

/**
 * The database as it stood before the activation, for this transaction: mode
 * `legacy`, no stream, no placement, and the fixture year's seats per class
 * and Day or Boarding. Returns the Enrolled imported child made here.
 */
async function beforeActivation(sql: Client): Promise<string> {
  await sql.query("select public.set_audit_actor('system')")
  // The replica role skips the refusal triggers (and every other one) for
  // the deletes only, without altering a table.
  await sql.query("set local session_replication_role = replica")
  await sql.query("delete from public.seat_placements")
  await sql.query("delete from public.seat_sync_queue")
  await sql.query("delete from public.stream_requests")
  await sql.query("delete from public.streams")
  await sql.query("delete from public.class_seats where enrollment_year = $1", [year])
  await sql.query("set local session_replication_role = origin")
  await sql.query("update public.seat_settings set mode = 'legacy'")
  for (const [className, choice, seats] of SEATS()) {
    await sql.query("insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values ($1, $2, $3, $4)", [
      year, className, choice, seats,
    ])
  }

  // An Enrolled student from the workbook import, with no payment (Q18),
  // made Enrolled the way the import does it: through its lifecycle override.
  const batch = await sql.query<{ id: string }>(
    `insert into public.import_batches (kind, file_name, imported_by, row_count, created_count, updated_count, skipped_count)
     values ('students', 'dry-run.csv', $1, 1, 1, 0, 0) returning id`,
    [MANAGER.id],
  )
  const contact = await sql.query<{ id: string }>(
    `insert into public.guardian_contacts (full_name, relationship, phone, origin)
     values ('Dry Run Parent', 'Mother', '+255700449449', 'front_desk') returning id`,
  )
  const imported = await sql.query<{ id: string }>(
    `insert into public.leads (admission_number, student_name, class_name, enrollment_year, day_or_boarding, status, visit_date,
         guardian_contact_id, import_batch_id, imported_as_enrolled)
     values ($1, 'Dry Run Imported', $2, $3, 'Day', 'Interviewed', '2026-09-01', $4, $5, true) returning id`,
    [importedNumber, over, year, contact.rows[0].id, batch.rows[0].id],
  )
  await sql.query("select set_config('app.lead_lifecycle_override', 'import', true)")
  await sql.query("update public.leads set status = 'Enrolled', enrolled_by_import = true where id = $1", [imported.rows[0].id])
  await sql.query("select set_config('app.lead_lifecycle_override', '', true)")
  return imported.rows[0].id
}

async function counts(sql: Client) {
  const { rows } = await sql.query<{ mode: string; streams: number; placed: number; waiting: number; audit_rows: number }>(
    `select (select mode from public.seat_settings) as mode,
            (select count(*)::int from public.streams) as streams,
            (select count(*)::int from public.seat_placements where stream_id is not null) as placed,
            (select count(*)::int from public.seat_placements where stream_id is null) as waiting,
            (select count(*)::int from public.audit_log where action = 'streams_activated') as audit_rows`,
  )
  return rows[0]
}

// Each lead as fee_snapshot() sees it: status, fee, Seat priority.
async function feesOf(sql: Client, ids: string[]) {
  const { rows } = await sql.query(
    `select l.id, l.status, l.closure, to_jsonb(fee) as fee, to_jsonb(seat) as seat
     from public.leads l
     cross join lateral public.lead_fee_amounts(l.id) fee
     cross join lateral public.lead_seat_priority(l.id) seat
     where l.id = any ($1) order by l.id`,
    [ids],
  )
  return rows
}

// Where each child is: "placed", "waiting", or "no seat" (no placement row).
async function seatsOf(sql: Client, ids: Record<string, string>): Promise<Record<string, string>> {
  const { rows } = await sql.query<{ lead_id: string; state: string }>(
    `select p.lead_id,
            case when p.stream_id is not null then 'placed in ' || s.class_name || ' ' || s.label
                 when p.waiting_class is not null then 'waiting for ' || p.waiting_class
                 else 'no seat' end as state
     from public.seat_placements p left join public.streams s on s.id = p.stream_id
     where p.lead_id = any ($1)`,
    [Object.values(ids)],
  )
  return Object.fromEntries(Object.entries(ids).map(([name, id]) => [name, rows.find((row) => row.lead_id === id)?.state ?? "no seat"]))
}

describe("the activation's dry run", () => {
  test(
    "moves the seats into one Mixed stream A per class, places the holders in ranking order, records it and switches the mode",
    async () => {
      await inRolledBackTransaction(async (sql) => {
        const imported = await beforeActivation(sql)
        const everyone = { ...lead, imported }
        const before = await counts(sql)
        expect(before).toEqual({ mode: "legacy", streams: 0, placed: 0, waiting: 0, audit_rows: before.audit_rows })
        const feesBefore = await feesOf(sql, Object.values(everyone))
        const lastAudit = (await sql.query<{ id: string }>("select coalesce(max(id), 0) as id from public.audit_log")).rows[0].id

        const report = (await sql.query<{ report: Report }>("select public.activate_streams() as report")).rows[0].report

        // The streams: one Mixed A, position 1, per class and year with seats set.
        const { rows: streams } = await sql.query<{ class_name: string; label: string; takes: string; seats: number; position: number; opened_by: string | null }>(
          "select class_name::text, label, takes::text, seats, position, opened_by from public.streams where enrollment_year = $1",
          [year],
        )
        const A = (className: string, seats: number) => ({ class_name: className, label: "A", takes: "Mixed", seats, position: 1, opened_by: null })
        expect(streams).toHaveLength(5)
        expect(streams).toEqual(
          expect.arrayContaining([
            A(both, 3), // Day 2 + Boarding 1 (Q8)
            A(daySet, 2), // the one side that was set (Q8)
            A(over, 2),
            A(zeroBoth, 0), // stays full (Q17)
            A(zeroOne, 2), // 0 on one side takes the other side's number (Q17)
          ]),
        )
        // Seats not set, or 0 on one side with the other not set: no stream,
        // so no limit.
        expect(streams.map((s) => s.class_name)).not.toContain(notSet)
        expect(streams.map((s) => s.class_name)).not.toContain(zeroUnset)

        // The children.
        expect(await seatsOf(sql, everyone)).toEqual({
          bothDay: `placed in ${both} A`,
          bothBoarding: `placed in ${both} A`,
          // Archived keeps the seat.
          bothArchived: `placed in ${both} A`,
          noPayment: "no seat",
          daySetDay: `placed in ${daySet} A`,
          // Day or boarding no longer splits the count.
          daySetBoarding: `placed in ${daySet} A`,
          // Two seats, four holders: Full first, then the oldest Deposit,
          // who has no Boy or girl answer and is placed like anyone (Q7).
          overFull: `placed in ${over} A`,
          overDepositOldNoAnswer: `placed in ${over} A`,
          overDepositMiddle: `waiting for ${over}`,
          overDepositLate: `waiting for ${over}`,
          // No seat before, none after.
          overDeclined: "no seat",
          overBelowDeposit: "no seat",
          imported: "no seat",
          zeroBoth: `waiting for ${zeroBoth}`,
          zeroOne: `placed in ${zeroOne} A`,
          // No stream in their class: neither placed nor waiting.
          zeroUnset: "no seat",
          notSet: "no seat",
        })
        const { rows: causes } = await sql.query<{ cause: string }>("select distinct cause from public.seat_placements")
        expect(causes).toEqual([{ cause: "migration" }])

        // Nothing but seats moved: every fee, status and Seat priority as before.
        expect(await feesOf(sql, Object.values(everyone))).toEqual(feesBefore)

        // The report, class by class for the fixture year.
        const mine = Object.fromEntries(report.classes.filter((entry) => entry.year === year).map((entry) => [entry.class, entry]))
        const line = (className: string, day: number | null, boarding: number | null, seats: number, holders: number, placed: number) => ({
          year, class: className, day_seats: day, boarding_seats: boarding, seats, seat_holders: holders, placed, waiting: holders - placed,
        })
        expect(mine).toEqual({
          [both]: line(both, 2, 1, 3, 3, 3),
          [daySet]: line(daySet, 2, null, 2, 2, 2),
          [over]: line(over, 1, 1, 2, 4, 2),
          [zeroBoth]: line(zeroBoth, 0, 0, 0, 1, 0),
          [zeroOne]: line(zeroOne, 0, 2, 2, 1, 1),
        })

        // Its totals, against the tables themselves.
        const after = await counts(sql)
        expect(after).toEqual({
          mode: "named",
          streams: report.streams_created,
          placed: report.children_placed,
          waiting: report.children_waiting,
          audit_rows: before.audit_rows + 1,
        })
        const { rows: shapes } = await sql.query<{ classes: number; one_side: number; zero_both: number; zero_one: number; zero_unset: number }>(
          `select (count(*) filter (where not (sides = 1 and most = 0)))::int as classes,
                  (count(*) filter (where sides = 1 and most > 0))::int as one_side,
                  (count(*) filter (where sides = 2 and most = 0))::int as zero_both,
                  (count(*) filter (where sides = 2 and least = 0 and most > 0))::int as zero_one,
                  (count(*) filter (where sides = 1 and most = 0))::int as zero_unset
           from (select count(*) as sides, min(seats) as least, max(seats) as most
                 from public.class_seats group by enrollment_year, class_name) c`,
        )
        expect({
          classes: report.streams_created,
          one_side: report.classes_with_one_of_day_and_boarding_set,
          zero_both: report.classes_at_0_on_both_sides,
          zero_one: report.classes_at_0_on_one_side_only,
          zero_unset: report.classes_at_0_with_other_side_not_set,
        }).toEqual(shapes[0])
        // The classes left with no stream are named, so the Manager can open
        // streams for them on Seats.
        expect(report.classes_left_with_no_stream).toHaveLength(report.classes_at_0_with_other_side_not_set)
        expect(report.classes_left_with_no_stream.filter((entry) => entry.year === year)).toEqual([
          { year, class: zeroUnset, day_seats: null, boarding_seats: 0, seat_holders: 1 },
        ])
        expect(mine[zeroUnset]).toBeUndefined()

        // The audit row the Super Admin reads: one, payment scope, as the system.
        const { rows: audit } = await sql.query(
          "select action, scope, actor_kind, actor_staff_id, table_name, new_values from public.audit_log where action = 'streams_activated' and id > $1",
          [lastAudit],
        )
        expect(audit).toEqual([
          { action: "streams_activated", scope: "payment", actor_kind: "system", actor_staff_id: null, table_name: null, new_values: report },
        ])
        // The switch itself is in the history too.
        const { rows: switched } = await sql.query(
          "select old_values, new_values -> 'mode' as mode from public.audit_log where table_name = 'seat_settings' and id > $1",
          [lastAudit],
        )
        expect(switched).toEqual([{ old_values: expect.objectContaining({ mode: "legacy" }), mode: "named" }])

        // For the lead's go request.
        const others = report.classes.filter((entry) => entry.year !== year)
        console.log(
          [
            "Dry run of activate_streams() (rolled back)",
            `Before: mode ${before.mode}, ${before.streams} streams, ${before.placed} placed, ${before.waiting} waiting`,
            `After:  mode ${after.mode}, ${after.streams} streams, ${after.placed} placed, ${after.waiting} waiting, 1 audit row (streams_activated)`,
            `Streams from a class with only one of Day and Boarding set: ${report.classes_with_one_of_day_and_boarding_set}; at 0 on both sides: ${report.classes_at_0_on_both_sides}; at 0 on one side only: ${report.classes_at_0_on_one_side_only}`,
            `Classes left with no stream (0 on one side, the other not set): ${report.classes_at_0_with_other_side_not_set}`,
            "",
            `Fixture year ${year}, shaped like the school's data:`,
            `${"class".padEnd(22)} | Day seats | Boarding seats | stream A seats | seat holders | placed | waiting`,
            ...[
              ["both", both],
              ["daySet", daySet],
              ["over", over],
              ["zeroBoth", zeroBoth],
              ["zeroOne", zeroOne],
            ].map(([name, className]) => {
              const c = mine[className]
              return `${`${name} (${className})`.padEnd(22)} | ${String(c.day_seats ?? "not set").padEnd(9)} | ${String(c.boarding_seats ?? "not set").padEnd(14)} | ${String(c.seats).padEnd(14)} | ${String(c.seat_holders).padEnd(12)} | ${String(c.placed).padEnd(6)} | ${c.waiting}`
            }),
            `${`zeroUnset (${zeroUnset})`.padEnd(22)} | not set   | 0              | no stream      | 1            | -      | -`,
            `${`notSet (${notSet})`.padEnd(22)} | not set   | not set        | no stream      | 1            | -      | -`,
            "",
            `Other years' seats moved in the same run (seeded and earlier tests'): ${others.length} classes, ${others.reduce((n, c) => n + c.placed, 0)} placed, ${others.reduce((n, c) => n + c.waiting, 0)} waiting`,
            "Fee snapshot: unchanged (asserted inside the function for every lead, and here for the fixture's)",
          ].join("\n"),
        )
      })
    },
    600_000,
  )

  test(
    "a failed check raises, and leaves the mode legacy with no stream, no placement and no audit row",
    async () => {
      // Another session holds one child's row, as a payment in flight would
      // without the migration's table locks: the engine skips the child, and
      // the activation refuses to go on.
      const other = new Client({ connectionString: process.env.SUPABASE_DB_URL })
      await other.connect()
      try {
        await other.query("begin")
        await other.query("select 1 from public.leads where id = $1 for update", [lead.overFull])
        await inRolledBackTransaction(async (sql) => {
          await beforeActivation(sql)
          const before = await counts(sql)
          expect(await refusal(sql, "select public.activate_streams()", [])).toBe("activation_child_busy")
          expect(await counts(sql)).toEqual(before)
          expect(before).toMatchObject({ mode: "legacy", streams: 0, placed: 0, waiting: 0 })
          const { rows } = await sql.query("select 1 from public.seat_sync_queue")
          expect(rows).toEqual([])
        })
      } finally {
        await other.query("rollback").catch(() => {})
        await other.end()
      }
    },
    600_000,
  )

  test("it runs once: refused when the mode is already named, and when a stream exists", async () => {
    await inRolledBackTransaction(async (sql) => {
      const before = await counts(sql)
      expect(before.mode).toBe("named")
      expect(await refusal(sql, "select public.activate_streams()", [])).toBe("streams_already_active")
      expect(await counts(sql)).toEqual(before)

      await sql.query("select public.set_audit_actor('system')")
      await sql.query("update public.seat_settings set mode = 'legacy'")
      expect(before.streams).toBeGreaterThan(0)
      expect(await refusal(sql, "select public.activate_streams()", [])).toBe("streams_exist")
      expect(await counts(sql)).toEqual({ ...before, mode: "legacy" })
    })
  })

  test("it refuses to start while the seat sync queue holds a row", async () => {
    await inRolledBackTransaction(async (sql) => {
      await beforeActivation(sql)
      // A retry left behind: the first check would read it as a skipped child.
      await sql.query("insert into public.seat_sync_queue (lead_id, cause, retry, retry_year, retry_class) values ($1, 'retry', true, $2, $3)", [
        lead.bothDay, year, both,
      ])
      const before = await counts(sql)
      expect(await refusal(sql, "select public.activate_streams()", [])).toBe("seat_queue_not_empty")
      expect(await counts(sql)).toEqual(before)
      expect(before).toMatchObject({ mode: "legacy", streams: 0 })
    })
  })

  test("no API role may run it", async () => {
    const granted = await inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query<{ role: string; granted: boolean }>(
        `select r.role, has_function_privilege(r.role, 'public.activate_streams()', 'execute') as granted
         from unnest(array['anon', 'authenticated', 'service_role']) r (role)`,
      )
      return rows.filter((row) => row.granted)
    })
    expect(granted).toEqual([])
  })
})

// 20270113100050: set_academic_year checks the seat mode again once it holds
// the year's schedule row. The activation holds the schedules while it moves
// the seats, so a Fee schedule save sent in that moment passes the first
// check under legacy and waits. This plays that moment with two sessions. It
// commits the mode as `legacy` for the length of the test and puts `named`
// back, which is why it is here, where nothing runs beside it.
describe("a seats save that crosses the activation", () => {
  test("passes the mode check under legacy, waits for the schedule row, and is refused once the mode is named", async () => {
    const activation = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    const save = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await activation.connect()
    await save.connect()
    const seatsOf = async () =>
      (await activation.query("select day_or_boarding::text, seats from public.class_seats where enrollment_year = $1 and class_name = $2 order by 1", [year, notSet])).rows
    try {
      const seatsBefore = await seatsOf()
      await asSystem((sql) => sql.query("update public.seat_settings set mode = 'legacy'"))

      // The activation: it holds the year's schedule and has switched the
      // mode, and has not committed yet.
      await activation.query("begin")
      await activation.query("select public.set_audit_actor('system')")
      await activation.query("select 1 from public.fee_schedules where enrollment_year = $1 for update", [year])
      await activation.query("update public.seat_settings set mode = 'named'")

      // The Manager's save, from a Fee schedule form that still has seat boxes.
      await save.query("begin")
      await actAsStaff(save, MANAGER.id)
      const { rows } = await save.query<{ pid: number }>("select pg_backend_pid() as pid")
      const settings = JSON.stringify({ seats: [{ class_name: notSet, day_or_boarding: "Day", seats: 30, was: null }] })
      const answer = save.query("select public.set_academic_year($1, $2::jsonb)", [year, settings]).then(
        () => "saved",
        (error: Error) => error.message,
      )

      // It got past the first check, or it would not be waiting for the row.
      await expect
        .poll(async () => (await activation.query("select wait_event_type from pg_stat_activity where pid = $1", [rows[0].pid])).rows[0]?.wait_event_type, {
          timeout: 15_000,
        })
        .toBe("Lock")

      await activation.query("commit")
      expect(await answer).toBe("seats_moved")
      await save.query("rollback")
      expect(await seatsOf()).toEqual(seatsBefore)
    } finally {
      await activation.query("rollback").catch(() => {})
      await save.query("rollback").catch(() => {})
      await activation.end()
      await save.end()
      await asSystem((sql) => sql.query("update public.seat_settings set mode = 'named' where mode <> 'named'"))
    }
  })
})
