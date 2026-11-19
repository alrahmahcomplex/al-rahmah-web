import { randomInt } from "node:crypto"

import { describe, expect, test } from "vitest"

import { Client } from "pg"

import {
  getFeeSchedule,
  saveFeeAmounts,
  setAcademicYear,
  type AcademicYearSeen,
  type FeeAmounts,
  type SeatSetting,
} from "@/lib/services/fees"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  secretClient,
  signedIn,
} from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER, SECOND_MANAGER } from "../support/fixtures"
import { asOwner, legacy } from "../support/streams"

// The Academic-year start through the fees module, against local Supabase,
// signed in as each seeded role. Each test works on a year of its own, far
// from the seeded 2027, which the Accountant creates first.
//
// Seats are counted in streams since the activation migration (#449), so a
// save that carries seats is refused. How the Manager set seats per class
// and Day or Boarding before that is still in set_academic_year until the
// clean-up slice removes it; the last describe tests it with the seat mode
// put back to `legacy` inside rolled-back transactions.

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_000, boarding: 3_000_000 },
    primary_lower: { day: 2_000_000, boarding: 3_000_000 },
    primary_upper: { day: 2_100_000, boarding: 3_300_000 },
    secondary: { day: 2_800_000, boarding: 4_300_000 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_000,
  preFormOne: { day: 450_000, boarding: 580_000 },
}

async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    for (;;) {
      const year = randomInt(2100, 3000)
      const taken = await sql.query("select 1 from public.fee_schedules where enrollment_year = $1", [year])
      if (taken.rowCount === 0) return year
    }
  })
}

// A year the Accountant has created a schedule for.
async function scheduledYear(): Promise<number> {
  const year = await unusedYear()
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), year, AMOUNTS)
  if (!saved.ok) throw new Error("schedule not created")
  return year
}

async function read(year: number) {
  const schedule = await getFeeSchedule(await signedIn(ACCOUNTANT), year)
  if (!schedule.ok) throw new Error("schedule not read")
  return { start: schedule.data.academicYearStart, seats: schedule.data.seats }
}

// What a form opened now would show: the saved start and seats, or nothing
// for a year with no schedule.
async function seenNow(year: number): Promise<AcademicYearSeen> {
  const schedule = await getFeeSchedule(await signedIn(ACCOUNTANT), year)
  return schedule.ok ? { start: schedule.data.academicYearStart, seats: schedule.data.seats } : { start: null, seats: [] }
}

// Saves from a fresh read, so nothing is stale.
async function saveFresh(
  client: Parameters<typeof setAcademicYear>[0],
  year: number,
  settings: Parameters<typeof setAcademicYear>[2],
) {
  return setAcademicYear(client, year, settings, await seenNow(year))
}

const seat = (className: SeatSetting["className"], dayOrBoarding: SeatSetting["dayOrBoarding"], seats: number | null) => ({
  className,
  dayOrBoarding,
  seats,
})

describe("setting the start", () => {
  test("the Manager sets the start, and every staff member with payments.view reads it", async () => {
    const year = await scheduledYear()
    const set = await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] })
    expect(set).toEqual({ ok: true, data: null })

    for (const person of [ACCOUNTANT, MANAGER, ADMISSIONS]) {
      const schedule = await getFeeSchedule(await signedIn(person), year)
      if (!schedule.ok) throw new Error(person.roleName)
      expect(schedule.data.academicYearStart, person.roleName).toBe(`${year}-01-11`)
    }
    // The amounts are untouched.
    const schedule = await getFeeSchedule(await signedIn(ACCOUNTANT), year)
    expect(schedule.ok && schedule.data.bands).toEqual(AMOUNTS.bands)
  })

  test("changing it later moves the start", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    await saveFresh(manager, year, { start: `${year}-01-11`, seats: [] })

    expect(await saveFresh(manager, year, { start: `${year}-01-04`, seats: [] })).toEqual({ ok: true, data: null })
    expect(await read(year)).toEqual({ start: `${year}-01-04`, seats: [] })
  })

  test("a save that carries seats is refused as out of date, and saves nothing, the start included", async () => {
    // Streams are on: a Fee schedule form left open from before still has its
    // seat boxes. The form reloads, now without them.
    const year = await scheduledYear()
    expect(
      await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] }),
    ).toEqual({ ok: false, error: { kind: "stale", field: null } })
    expect(await read(year)).toEqual({ start: null, seats: [] })
  })

  test("a year with no Fee schedule is refused until the Accountant creates one", async () => {
    const year = await unusedYear()
    expect(await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] })).toEqual({
      ok: false,
      error: { kind: "no-schedule" },
    })
    expect(await getFeeSchedule(await signedIn(ACCOUNTANT), year)).toEqual({ ok: false, error: "not-found" })
  })

  test("the seeded 2027 schedule starts in January, and still reads the seats set before streams", async () => {
    const { start, seats } = await read(2027)
    expect(start).toMatch(/^2027-01-\d{2}$/)
    expect(seats.length).toBeGreaterThan(2)
    expect(seats).toContainEqual(seat("KG 2", "Boarding", 2))
  })
})

describe("refusals", () => {
  async function refused(year: number, settings: Parameters<typeof saveFresh>[2], field: string) {
    const before = await read(year)
    expect(await saveFresh(await signedIn(MANAGER), year, settings), field).toEqual({
      ok: false,
      error: { kind: "invalid", field },
    })
    expect(await read(year), `${field} saved nothing`).toEqual(before)
  }

  test("a start outside January of the year", async () => {
    const year = await scheduledYear()
    await refused(year, { start: `${year}-02-01`, seats: [] }, "academic_year_start")
    await refused(year, { start: `${year - 1}-12-31`, seats: [] }, "academic_year_start")
    await refused(year, { start: `${year + 1}-01-11`, seats: [] }, "academic_year_start")
    await refused(year, { start: `${year}-01-32`, seats: [] }, "academic_year_start")
    await refused(year, { start: "next January", seats: [] }, "academic_year_start")
  })

  test("a start, once set, can't be cleared", async () => {
    const year = await scheduledYear()
    await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] })
    await refused(year, { start: null, seats: [] }, "academic_year_start")
  })
})

describe("permissions", () => {
  test("the Accountant and Admissions Staff can't set the start", async () => {
    const year = await scheduledYear()
    for (const person of [ACCOUNTANT, ADMISSIONS]) {
      expect(await saveFresh(await signedIn(person), year, { start: `${year}-01-11`, seats: [] }), person.roleName).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      })
    }
    expect(await read(year)).toEqual({ start: null, seats: [] })
  })

  test("someone signed out, and the secret key, can't set it or read the seats", async () => {
    const year = await scheduledYear()
    for (const client of [anonClient(), secretClient()]) {
      expect((await saveFresh(client, year, { start: `${year}-01-11`, seats: [] })).ok).toBe(false)
    }
    expect(await read(year)).toEqual({ start: null, seats: [] })
    const { data } = await anonClient().from("class_seats").select("id")
    expect(data).toEqual([])

    // Not merely refused inside: anon may not execute it at all.
    const granted = await inRolledBackTransaction(async (sql) => {
      const result = await sql.query(
        "select has_function_privilege('anon', 'public.set_academic_year(integer, jsonb)', 'execute') as anon",
      )
      return result.rows[0].anon
    })
    expect(granted).toBe(false)
  })

  test("managing academic years without payments.view may set it, but reads nothing back", async () => {
    const year = await scheduledYear()
    const keeper = await signedIn(await createThrowawayStaff(["academic_years.manage"]))
    expect(await saveFresh(keeper, year, { start: `${year}-01-11`, seats: [] })).toEqual({
      ok: true,
      data: null,
    })
    expect(await getFeeSchedule(keeper, year)).toEqual({ ok: false, error: "not-found" })
    const { data } = await keeper.from("class_seats").select("id")
    expect(data).toEqual([])
  })

  test("nobody writes the seats directly, through the API", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    const insert = await manager
      .from("class_seats")
      .insert({ enrollment_year: year, class_name: "STD 1", day_or_boarding: "Day", seats: 30 })
    expect(insert.error).not.toBeNull()
    const update = await manager.from("class_seats").update({ seats: 0 }).eq("enrollment_year", 2027)
    expect(update.error).not.toBeNull()
    const start = await manager.from("fee_schedules").update({ academic_year_start: "2027-01-04" }).eq("enrollment_year", 2027)
    expect(start.error).not.toBeNull()
    expect((await read(2027)).seats).toContainEqual(seat("KG 2", "Boarding", 2))
  })

  test("the seats set before streams are never deleted, even by the database owner", async () => {
    const year = await scheduledYear()
    await asSystem((sql) =>
      sql.query("insert into public.class_seats (enrollment_year, class_name, day_or_boarding, seats) values ($1, 'STD 1', 'Day', 30)", [year]),
    )
    await expect(
      asSystem((sql) => sql.query("delete from public.class_seats where enrollment_year = $1", [year])),
    ).rejects.toThrow(/delete_refused/)
    expect((await read(year)).seats).toEqual([seat("STD 1", "Day", 30)])
  })
})

describe("two Managers editing the same year", () => {
  test("a start changed from an older view is refused, and the newer start stays", async () => {
    const year = await scheduledYear()
    const opened = await seenNow(year)
    await setAcademicYear(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] }, opened)

    expect(await setAcademicYear(await signedIn(SECOND_MANAGER), year, { start: `${year}-01-04`, seats: [] }, opened)).toEqual({
      ok: false,
      error: { kind: "stale", field: "academic_year_start" },
    })
    expect(await read(year)).toEqual({ start: `${year}-01-11`, seats: [] })
  })
})

describe("what a save leaves out", () => {
  test("the database keeps the start when a call leaves it out, and refuses a null start once one is set", async () => {
    const year = await scheduledYear()
    await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] })
    const manager = await signedIn(MANAGER)

    const leftOut = await manager.rpc("set_academic_year", { schedule_year: year, settings: { seats: [] } })
    expect(leftOut.error).toBeNull()
    expect((await read(year)).start).toBe(`${year}-01-11`)

    const cleared = await manager.rpc("set_academic_year", {
      schedule_year: year,
      settings: { academic_year_start: null, academic_year_start_was: `${year}-01-11`, seats: [] },
    })
    expect(cleared.error?.message).toBe("invalid")
    expect(JSON.parse(cleared.error?.details ?? "{}")).toEqual({ field: "academic_year_start" })
    expect((await read(year)).start).toBe(`${year}-01-11`)
  })

  test("a start that doesn't say what it replaces is refused", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    const noStartWas = await manager.rpc("set_academic_year", {
      schedule_year: year,
      settings: { academic_year_start: `${year}-01-11`, seats: [] },
    })
    expect(noStartWas.error?.message).toBe("invalid")
    expect(await read(year)).toEqual({ start: null, seats: [] })
  })
})

describe("a start of today or earlier", () => {
  // Runs set_academic_year as the Manager inside one rolled-back transaction,
  // with enrol_from_academic_year_start swapped for a recorder, and returns
  // the date it was called with, or null when it wasn't called.
  async function enrolCalledWith(year: number, start: string): Promise<string | null> {
    const sql = new Client({ connectionString: process.env.SUPABASE_DB_URL })
    await sql.connect()
    try {
      await sql.query("begin")
      await sql.query(`
        create or replace function public.enrol_from_academic_year_start(as_of date)
        returns integer language plpgsql security definer set search_path = '' as $$
        begin
            perform set_config('test.enrolled_as_of', as_of::text, true);
            return 0;
        end;
        $$`)
      await sql.query("select public.set_audit_actor('system')")
      await sql.query(
        `insert into public.fee_schedules (enrollment_year, first_due, second_due, third_due, minimum_deposit,
           pre_form_one_day_fee, pre_form_one_boarding_fee)
         values ($1, $2, $3, $4, 300000, 450000, 580000)`,
        [year, `${year - 1}-11-01`, `${year}-04-01`, `${year}-06-01`],
      )
      const [{ user_id: userId }] = (
        await sql.query("select user_id from public.staff_members where id = $1", [MANAGER.id])
      ).rows as { user_id: string }[]
      await sql.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify({ sub: userId, role: "authenticated" }),
      ])
      await sql.query("set local role authenticated")
      await sql.query("select public.set_academic_year($1, $2)", [
        year,
        JSON.stringify({ academic_year_start: start, academic_year_start_was: null, seats: [] }),
      ])
      const { rows } = await sql.query("select nullif(current_setting('test.enrolled_as_of', true), '') as as_of")
      return rows[0].as_of
    } finally {
      await sql.query("rollback").catch(() => {})
      await sql.end()
    }
  }

  async function today(): Promise<string> {
    return inRolledBackTransaction(async (sql) => (await sql.query("select public.tanzania_today()::text as d")).rows[0].d)
  }

  // A year whose schedule exists only inside the rolled-back transaction.
  async function freeYear(from: number, to: number): Promise<number> {
    return inRolledBackTransaction(async (sql) => {
      const { rows } = await sql.query(
        `select y from generate_series($1::int, $2::int) y
         where not exists (select 1 from public.fee_schedules s where s.enrollment_year = y)
         order by random() limit 1`,
        [from, to],
      )
      if (rows.length === 0) throw new Error("no free year")
      return rows[0].y
    })
  }

  test("a start in a past January enrols at once, as of today", async () => {
    const now = await today()
    const year = await freeYear(2000, Number(now.slice(0, 4)) - 1)
    expect(await enrolCalledWith(year, `${year}-01-11`)).toBe(now)
  })

  test("a start still to come waits for the daily job", async () => {
    const year = await unusedYear()
    expect(await enrolCalledWith(year, `${year}-01-11`)).toBeNull()
  })

  test("only the database itself may run the enrolment", async () => {
    const granted = await inRolledBackTransaction(async (sql) => {
      const result = await sql.query(
        `select has_function_privilege('anon', 'public.enrol_from_academic_year_start(date)', 'execute') as anon,
                has_function_privilege('authenticated', 'public.enrol_from_academic_year_start(date)', 'execute') as staff`,
      )
      return result.rows[0]
    })
    expect(granted).toEqual({ anon: false, staff: false })
  })
})

describe("history", () => {
  test("setting and changing the start is recorded with the Manager, and the old and new values", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    await saveFresh(manager, year, { start: `${year}-01-11`, seats: [] })
    await saveFresh(manager, year, { start: `${year}-01-04`, seats: [] })

    const entries = await inRolledBackTransaction(async (sql) => {
      const result = await sql.query(
        `select a.old_values, a.new_values, s.full_name as name, a.scope, a.lead_id
         from public.audit_log a
         join public.staff_members s on s.id = a.actor_staff_id
         where a.table_name = 'fee_schedules' and a.action = 'update'
           and a.row_id in (select id from public.fee_schedules where enrollment_year = $1)
         order by a.id`,
        [year],
      )
      return result.rows as { old_values: unknown; new_values: unknown; name: string; scope: string; lead_id: string | null }[]
    })

    expect(entries.every((e) => e.name === MANAGER.name && e.scope === "payment" && e.lead_id === null)).toBe(true)
    expect(entries.map(({ old_values, new_values }) => ({ old_values, new_values }))).toEqual([
      { old_values: { academic_year_start: null }, new_values: { academic_year_start: `${year}-01-11` } },
      { old_values: { academic_year_start: `${year}-01-11` }, new_values: { academic_year_start: `${year}-01-04` } },
    ])
  })
})

// How the Manager set seats per class and Day or Boarding before streams
// (#449). Nothing reaches this once the seat mode is `named`, and the
// clean-up slice removes it from set_academic_year; until then it is tested
// here with the mode put back to `legacy` for one rolled-back transaction.
describe("seats before streams (legacy seat mode)", () => {
  type Entry = { class_name: string; day_or_boarding: string; seats?: number | null; was?: number | null }
  type Settings = { academic_year_start?: string | null; academic_year_start_was?: string | null; seats: Entry[] }

  // "saved", or the refusal with the field it names.
  async function save(sql: Client, year: number, settings: Settings): Promise<"saved" | { refused: string; field?: string }> {
    await sql.query("savepoint save")
    try {
      await sql.query("select public.set_academic_year($1, $2::jsonb)", [year, JSON.stringify(settings)])
      await sql.query("release savepoint save")
      return "saved"
    } catch (error) {
      await sql.query("rollback to savepoint save")
      const { message, detail } = error as Error & { detail?: string }
      return { refused: message, ...(detail ? { field: (JSON.parse(detail) as { field: string }).field } : {}) }
    }
  }

  // The year's seats in class order, Day before Boarding.
  async function seatsOf(sql: Client, year: number): Promise<string[]> {
    const { rows } = await sql.query<{ line: string }>(
      `select c.class_name || ' ' || c.day_or_boarding || ' ' || c.seats as line
       from public.class_seats c where c.enrollment_year = $1 order by c.class_name, c.day_or_boarding`,
      [year],
    )
    return rows.map((row) => row.line)
  }

  const set = (class_name: string, day_or_boarding: string, seats: number | null, was: number | null = null): Entry => ({
    class_name,
    day_or_boarding,
    seats,
    was,
  })

  test("the Manager sets seats, changes the counts given and leaves the rest; a count once set can't be cleared", async () => {
    const year = await scheduledYear()
    await inRolledBackTransaction(async (sql) => {
      await legacy(sql)
      expect(
        await save(sql, year, { seats: [set("FORM 1", "Boarding", 30), set("KG 1", "Day", 25), set("FORM 1", "Day", 0), set("STD 1", "Day", null)] }),
      ).toBe("saved")
      // STD 1 Day stays not set, and no start is needed first.
      expect(await seatsOf(sql, year)).toEqual(["KG 1 Day 25", "FORM 1 Day 0", "FORM 1 Boarding 30"])

      expect(await save(sql, year, { seats: [set("KG 1", "Day", 26, 25), set("STD 1", "Boarding", 10)] })).toBe("saved")
      expect(await seatsOf(sql, year)).toEqual(["KG 1 Day 26", "STD 1 Boarding 10", "FORM 1 Day 0", "FORM 1 Boarding 30"])

      expect(await save(sql, year, { seats: [set("KG 1", "Day", null, 26)] })).toEqual({ refused: "invalid", field: "seats.KG 1.Day" })
      expect(await seatsOf(sql, year)).toContain("KG 1 Day 26")
    })
  })

  test("refuses a count that isn't a whole number, 0 or more, an unknown class, the same class twice, and a change that doesn't say what it replaces", async () => {
    const year = await scheduledYear()
    await inRolledBackTransaction(async (sql) => {
      await legacy(sql)
      expect(await save(sql, year, { seats: [set("STD 3", "Day", 30), set("STD 3", "Boarding", -1)] })).toEqual({
        refused: "invalid",
        field: "seats.STD 3.Boarding",
      })
      expect(await save(sql, year, { seats: [set("FORM 2", "Day", 12.5)] })).toEqual({ refused: "invalid", field: "seats.FORM 2.Day" })
      expect(await save(sql, year, { seats: [set("STD 8", "Day", 30)] })).toEqual({ refused: "invalid", field: "seats" })
      expect(await save(sql, year, { seats: [set("STD 1", "Weekly", 30)] })).toEqual({ refused: "invalid", field: "seats" })
      expect(await save(sql, year, { seats: [set("STD 1", "Day", 30), set("STD 1", "Day", 31)] })).toEqual({ refused: "invalid", field: "seats" })
      expect(await save(sql, year, { seats: [{ class_name: "STD 1", day_or_boarding: "Day", seats: 30 }] })).toEqual({ refused: "invalid", field: "seats" })
      // A refused start saves none of the seats with it.
      expect(
        await save(sql, year, { academic_year_start: `${year}-03-01`, academic_year_start_was: null, seats: [set("STD 1", "Day", 30)] }),
      ).toEqual({ refused: "invalid", field: "academic_year_start" })
      expect(await seatsOf(sql, year)).toEqual([])
    })
  })

  test("a count changed from an older view is refused, naming the class, and a cell the older view didn't change is kept", async () => {
    const year = await scheduledYear()
    await inRolledBackTransaction(async (sql) => {
      await legacy(sql)
      expect(await save(sql, year, { seats: [set("STD 1", "Day", 30)] })).toBe("saved")
      // A second form, opened before that save, still shows STD 1 Day blank.
      expect(await save(sql, year, { seats: [set("STD 1", "Day", 25)] })).toEqual({ refused: "stale", field: "seats.STD 1.Day" })
      expect(await save(sql, year, { seats: [set("STD 2", "Day", 28)] })).toBe("saved")
      expect(await seatsOf(sql, year)).toEqual(["STD 1 Day 30", "STD 2 Day 28"])
    })
  })

  test("each seat set or changed is recorded with the Manager, and an unchanged count records nothing", async () => {
    const year = await scheduledYear()
    await inRolledBackTransaction(async (sql) => {
      await legacy(sql)
      expect(await save(sql, year, { seats: [set("STD 1", "Day", 30), set("STD 2", "Day", 28)] })).toBe("saved")
      // STD 2 is unchanged, so it records nothing.
      expect(await save(sql, year, { seats: [set("STD 1", "Day", 32, 30), set("STD 2", "Day", 28, 28)] })).toBe("saved")
      await asOwner(sql)
      const { rows } = await sql.query(
        `select a.action, a.old_values, a.new_values, s.full_name as name, a.scope
         from public.audit_log a
         join public.staff_members s on s.id = a.actor_staff_id
         where a.table_name = 'class_seats' and a.row_id in (select id from public.class_seats where enrollment_year = $1)
         order by a.id`,
        [year],
      )
      expect(rows.every((row) => row.name === MANAGER.name && row.scope === "payment")).toBe(true)
      expect(rows.map(({ action, old_values, new_values }) => ({ action, old_values, new_values }))).toEqual([
        { action: "insert", old_values: null, new_values: expect.objectContaining({ class_name: "STD 1", seats: 30 }) },
        { action: "insert", old_values: null, new_values: expect.objectContaining({ class_name: "STD 2", seats: 28 }) },
        { action: "update", old_values: { seats: 30 }, new_values: { seats: 32 } },
      ])
    })
  })
})
