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

// The Academic-year start and class seats through the fees module, against
// local Supabase, signed in as each seeded role. Each test works on a year of
// its own, far from the seeded 2027, which the Accountant creates first.

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

describe("setting the start and seats", () => {
  test("the Manager sets the start and seats, and every staff member with payments.view reads them", async () => {
    const year = await scheduledYear()
    const set = await saveFresh(await signedIn(MANAGER), year, {
      start: `${year}-01-11`,
      seats: [seat("FORM 1", "Boarding", 30), seat("KG 1", "Day", 25), seat("FORM 1", "Day", 0), seat("STD 1", "Day", null)],
    })
    expect(set).toEqual({ ok: true, data: null })

    for (const person of [ACCOUNTANT, MANAGER, ADMISSIONS]) {
      const schedule = await getFeeSchedule(await signedIn(person), year)
      if (!schedule.ok) throw new Error(person.roleName)
      expect(schedule.data.academicYearStart, person.roleName).toBe(`${year}-01-11`)
      // In class order, Day before Boarding; STD 1 Day stays not set.
      expect(schedule.data.seats, person.roleName).toEqual([
        seat("KG 1", "Day", 25),
        seat("FORM 1", "Day", 0),
        seat("FORM 1", "Boarding", 30),
      ])
    }
    // The amounts are untouched.
    const schedule = await getFeeSchedule(await signedIn(ACCOUNTANT), year)
    expect(schedule.ok && schedule.data.bands).toEqual(AMOUNTS.bands)
  })

  test("changing them later moves the start and the counts given, and leaves the rest", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    await saveFresh(manager, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30), seat("STD 2", "Day", 28)] })

    expect(
      await saveFresh(manager, year, { start: `${year}-01-04`, seats: [seat("STD 1", "Day", 32), seat("STD 1", "Boarding", 10)] }),
    ).toEqual({ ok: true, data: null })
    expect(await read(year)).toEqual({
      start: `${year}-01-04`,
      seats: [seat("STD 1", "Day", 32), seat("STD 1", "Boarding", 10), seat("STD 2", "Day", 28)],
    })
  })

  test("seats can be set before the start, which stays empty", async () => {
    const year = await scheduledYear()
    expect(await saveFresh(await signedIn(MANAGER), year, { start: null, seats: [seat("KG 2", "Day", 20)] })).toEqual({
      ok: true,
      data: null,
    })
    expect(await read(year)).toEqual({ start: null, seats: [seat("KG 2", "Day", 20)] })
  })

  test("a year with no Fee schedule is refused until the Accountant creates one", async () => {
    const year = await unusedYear()
    expect(await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] })).toEqual({
      ok: false,
      error: { kind: "no-schedule" },
    })
    expect(await getFeeSchedule(await signedIn(ACCOUNTANT), year)).toEqual({ ok: false, error: "not-found" })
  })

  test("the seeded 2027 schedule starts in January and has seats for a few classes, KG 2 Boarding small", async () => {
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

  test("a refused start saves none of the seats with it", async () => {
    const year = await scheduledYear()
    await refused(year, { start: `${year}-03-01`, seats: [seat("STD 1", "Day", 30)] }, "academic_year_start")
  })

  test("a seat count that isn't a whole number, 0 or more, naming the class and Day or Boarding", async () => {
    const year = await scheduledYear()
    await refused(year, { start: null, seats: [seat("STD 3", "Day", 30), seat("STD 3", "Boarding", -1)] }, "seats.STD 3.Boarding")
    await refused(year, { start: null, seats: [seat("FORM 2", "Day", 12.5)] }, "seats.FORM 2.Day")
    await refused(year, { start: null, seats: [seat("FORM 2", "Day", Number.NaN)] }, "seats.FORM 2.Day")
  })

  test("an unknown class, or the same class twice", async () => {
    const year = await scheduledYear()
    await refused(year, { start: null, seats: [seat("STD 8" as SeatSetting["className"], "Day", 30)] }, "seats")
    await refused(year, { start: null, seats: [seat("STD 1", "Weekly" as SeatSetting["dayOrBoarding"], 30)] }, "seats")
    await refused(year, { start: null, seats: [seat("STD 1", "Day", 30), seat("STD 1", "Day", 31)] }, "seats")
  })

  test("a start or a seat count, once set, can't be cleared", async () => {
    const year = await scheduledYear()
    await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })
    await refused(year, { start: null, seats: [] }, "academic_year_start")
    await refused(year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", null)] }, "seats.STD 1.Day")
  })
})

describe("permissions", () => {
  test("the Accountant and Admissions Staff can't set the start or seats", async () => {
    const year = await scheduledYear()
    for (const person of [ACCOUNTANT, ADMISSIONS]) {
      expect(
        await saveFresh(await signedIn(person), year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] }),
        person.roleName,
      ).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await read(year)).toEqual({ start: null, seats: [] })
  })

  test("someone signed out, and the secret key, can't set them or read the seats", async () => {
    const year = await scheduledYear()
    for (const client of [anonClient(), secretClient()]) {
      expect((await saveFresh(client, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })).ok).toBe(false)
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

  test("managing academic years without payments.view may set them, but reads nothing back", async () => {
    const year = await scheduledYear()
    const keeper = await signedIn(await createThrowawayStaff(["academic_years.manage"]))
    expect(await saveFresh(keeper, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })).toEqual({
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

  test("seats are never deleted, even by the database owner", async () => {
    const year = await scheduledYear()
    await saveFresh(await signedIn(MANAGER), year, { start: null, seats: [seat("STD 1", "Day", 30)] })
    await expect(
      asSystem((sql) => sql.query("delete from public.class_seats where enrollment_year = $1", [year])),
    ).rejects.toThrow(/delete_refused/)
    expect((await read(year)).seats).toEqual([seat("STD 1", "Day", 30)])
  })
})

describe("two Managers editing the same year", () => {
  test("a save from an older view is refused, and the newer change stays", async () => {
    const year = await scheduledYear()
    const opened = await seenNow(year)

    expect(await setAcademicYear(await signedIn(MANAGER), year, { start: null, seats: [seat("STD 1", "Day", 30)] }, opened)).toEqual({
      ok: true,
      data: null,
    })
    expect(
      await setAcademicYear(await signedIn(SECOND_MANAGER), year, { start: null, seats: [seat("STD 1", "Day", 25)] }, opened),
    ).toEqual({ ok: false, error: { kind: "stale", field: "seats.STD 1.Day" } })
    expect(await read(year)).toEqual({ start: null, seats: [seat("STD 1", "Day", 30)] })
  })

  test("a save from an older view keeps the cells it didn't change", async () => {
    const year = await scheduledYear()
    const opened = await seenNow(year)
    await setAcademicYear(await signedIn(MANAGER), year, { start: null, seats: [seat("STD 1", "Day", 30)] }, opened)

    // The second form still shows STD 1 Day blank, as it was when it opened,
    // and changes only STD 2 Day.
    const secondForm = { start: null, seats: [seat("STD 1", "Day", null), seat("STD 2", "Day", 28)] }
    expect(await setAcademicYear(await signedIn(SECOND_MANAGER), year, secondForm, opened)).toEqual({ ok: true, data: null })
    expect(await read(year)).toEqual({ start: null, seats: [seat("STD 1", "Day", 30), seat("STD 2", "Day", 28)] })
  })

  test("a start changed from an older view is refused, and nothing in that save is written", async () => {
    const year = await scheduledYear()
    const opened = await seenNow(year)
    await setAcademicYear(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] }, opened)

    expect(
      await setAcademicYear(
        await signedIn(SECOND_MANAGER),
        year,
        { start: `${year}-01-04`, seats: [seat("KG 1", "Day", 20)] },
        opened,
      ),
    ).toEqual({ ok: false, error: { kind: "stale", field: "academic_year_start" } })
    expect(await read(year)).toEqual({ start: `${year}-01-11`, seats: [] })
  })
})

describe("what a save leaves out", () => {
  test("seats changed on their own keep the start that is set", async () => {
    const year = await scheduledYear()
    await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })

    expect(await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 31)] })).toEqual({
      ok: true,
      data: null,
    })
    expect(await read(year)).toEqual({ start: `${year}-01-11`, seats: [seat("STD 1", "Day", 31)] })
  })

  test("the database keeps the start when a call leaves it out, and refuses a null start once one is set", async () => {
    const year = await scheduledYear()
    await saveFresh(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] })
    const manager = await signedIn(MANAGER)

    const leftOut = await manager.rpc("set_academic_year", {
      schedule_year: year,
      settings: { seats: [{ class_name: "STD 1", day_or_boarding: "Day", seats: 30, was: null }] },
    })
    expect(leftOut.error).toBeNull()
    expect(await read(year)).toEqual({ start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })

    const cleared = await manager.rpc("set_academic_year", {
      schedule_year: year,
      settings: { academic_year_start: null, academic_year_start_was: `${year}-01-11`, seats: [] },
    })
    expect(cleared.error?.message).toBe("invalid")
    expect(JSON.parse(cleared.error?.details ?? "{}")).toEqual({ field: "academic_year_start" })
    expect((await read(year)).start).toBe(`${year}-01-11`)
  })

  test("a change that doesn't say what it replaces is refused", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    const noStartWas = await manager.rpc("set_academic_year", {
      schedule_year: year,
      settings: { academic_year_start: `${year}-01-11`, seats: [] },
    })
    expect(noStartWas.error?.message).toBe("invalid")
    const noSeatWas = await manager.rpc("set_academic_year", {
      schedule_year: year,
      settings: { seats: [{ class_name: "STD 1", day_or_boarding: "Day", seats: 30 }] },
    })
    expect(noSeatWas.error?.message).toBe("invalid")
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
  test("setting and changing the start and seats is recorded with the Manager, and the old and new values", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    await saveFresh(manager, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30), seat("STD 2", "Day", 28)] })
    // STD 2 is unchanged, so it records nothing.
    await saveFresh(manager, year, { start: `${year}-01-04`, seats: [seat("STD 1", "Day", 32), seat("STD 2", "Day", 28)] })

    const entries = await inRolledBackTransaction(async (sql) => {
      const result = await sql.query(
        `select a.table_name, a.action, a.old_values, a.new_values, s.full_name as name, a.scope, a.lead_id
         from public.audit_log a
         join public.staff_members s on s.id = a.actor_staff_id
         where (a.table_name = 'class_seats' and a.row_id in (select id from public.class_seats where enrollment_year = $1))
            or (a.table_name = 'fee_schedules' and a.action = 'update'
                and a.row_id in (select id from public.fee_schedules where enrollment_year = $1))
         order by a.id`,
        [year],
      )
      return result.rows as {
        table_name: string
        action: string
        old_values: unknown
        new_values: Record<string, unknown>
        name: string
        scope: string
        lead_id: string | null
      }[]
    })

    expect(entries.every((e) => e.name === MANAGER.name && e.scope === "payment" && e.lead_id === null)).toBe(true)
    expect(entries.map(({ table_name, action, old_values, new_values }) => ({ table_name, action, old_values, new_values }))).toEqual([
      { table_name: "fee_schedules", action: "update", old_values: { academic_year_start: null }, new_values: { academic_year_start: `${year}-01-11` } },
      { table_name: "class_seats", action: "insert", old_values: null, new_values: expect.objectContaining({ class_name: "STD 1", seats: 30 }) },
      { table_name: "class_seats", action: "insert", old_values: null, new_values: expect.objectContaining({ class_name: "STD 2", seats: 28 }) },
      { table_name: "fee_schedules", action: "update", old_values: { academic_year_start: `${year}-01-11` }, new_values: { academic_year_start: `${year}-01-04` } },
      { table_name: "class_seats", action: "update", old_values: { seats: 30 }, new_values: { seats: 32 } },
    ])
  })
})
