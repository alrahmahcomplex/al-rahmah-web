import { randomInt } from "node:crypto"

import { describe, expect, test } from "vitest"

import { getFeeSchedule, saveFeeAmounts, setAcademicYear, type FeeAmounts, type SeatSetting } from "@/lib/services/fees"

import {
  anonClient,
  asSystem,
  createThrowawayStaff,
  inRolledBackTransaction,
  secretClient,
  signedIn,
} from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

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

const seat = (className: SeatSetting["className"], dayOrBoarding: SeatSetting["dayOrBoarding"], seats: number | null) => ({
  className,
  dayOrBoarding,
  seats,
})

describe("setting the start and seats", () => {
  test("the Manager sets the start and seats, and every staff member with payments.view reads them", async () => {
    const year = await scheduledYear()
    const set = await setAcademicYear(await signedIn(MANAGER), year, {
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
    await setAcademicYear(manager, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30), seat("STD 2", "Day", 28)] })

    expect(
      await setAcademicYear(manager, year, { start: `${year}-01-04`, seats: [seat("STD 1", "Day", 32), seat("STD 1", "Boarding", 10)] }),
    ).toEqual({ ok: true, data: null })
    expect(await read(year)).toEqual({
      start: `${year}-01-04`,
      seats: [seat("STD 1", "Day", 32), seat("STD 1", "Boarding", 10), seat("STD 2", "Day", 28)],
    })
  })

  test("seats can be set before the start, which stays empty", async () => {
    const year = await scheduledYear()
    expect(await setAcademicYear(await signedIn(MANAGER), year, { start: null, seats: [seat("KG 2", "Day", 20)] })).toEqual({
      ok: true,
      data: null,
    })
    expect(await read(year)).toEqual({ start: null, seats: [seat("KG 2", "Day", 20)] })
  })

  test("a year with no Fee schedule is refused until the Accountant creates one", async () => {
    const year = await unusedYear()
    expect(await setAcademicYear(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [] })).toEqual({
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
  async function refused(year: number, settings: Parameters<typeof setAcademicYear>[2], field: string) {
    const before = await read(year)
    expect(await setAcademicYear(await signedIn(MANAGER), year, settings), field).toEqual({
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
    await setAcademicYear(await signedIn(MANAGER), year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })
    await refused(year, { start: null, seats: [] }, "academic_year_start")
    await refused(year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", null)] }, "seats.STD 1.Day")
  })
})

describe("permissions", () => {
  test("the Accountant and Admissions Staff can't set the start or seats", async () => {
    const year = await scheduledYear()
    for (const person of [ACCOUNTANT, ADMISSIONS]) {
      expect(
        await setAcademicYear(await signedIn(person), year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] }),
        person.roleName,
      ).toEqual({ ok: false, error: { kind: "forbidden" } })
    }
    expect(await read(year)).toEqual({ start: null, seats: [] })
  })

  test("someone signed out, and the secret key, can't set them or read the seats", async () => {
    const year = await scheduledYear()
    for (const client of [anonClient(), secretClient()]) {
      expect((await setAcademicYear(client, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })).ok).toBe(false)
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
    expect(await setAcademicYear(keeper, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30)] })).toEqual({
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
    await setAcademicYear(await signedIn(MANAGER), year, { start: null, seats: [seat("STD 1", "Day", 30)] })
    await expect(
      asSystem((sql) => sql.query("delete from public.class_seats where enrollment_year = $1", [year])),
    ).rejects.toThrow(/delete_refused/)
    expect((await read(year)).seats).toEqual([seat("STD 1", "Day", 30)])
  })
})

describe("history", () => {
  test("setting and changing the start and seats is recorded with the Manager, and the old and new values", async () => {
    const year = await scheduledYear()
    const manager = await signedIn(MANAGER)
    await setAcademicYear(manager, year, { start: `${year}-01-11`, seats: [seat("STD 1", "Day", 30), seat("STD 2", "Day", 28)] })
    // STD 2 is unchanged, so it records nothing.
    await setAcademicYear(manager, year, { start: `${year}-01-04`, seats: [seat("STD 1", "Day", 32), seat("STD 2", "Day", 28)] })

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
