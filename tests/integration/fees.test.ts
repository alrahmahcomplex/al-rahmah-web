import { randomInt } from "node:crypto"

import { describe, expect, test } from "vitest"

import {
  BAND_CLASSES,
  FEE_BANDS,
  getFeeSchedule,
  listFeeSchedules,
  saveFeeAmounts,
  type FeeAmounts,
} from "@/lib/services/fees"
import { LEAD_CLASSES } from "@/lib/services/leads"

import { anonClient, asSystem, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// The Fee schedule through the fees module, against local Supabase, signed in
// as each seeded role. Each test saves its own enrollment year, far from the
// seeded 2027, so tests never share a schedule.

// A year no schedule holds yet.
async function unusedYear(): Promise<number> {
  return inRolledBackTransaction(async (sql) => {
    for (;;) {
      const year = randomInt(2100, 3000)
      const taken = await sql.query("select 1 from public.fee_schedules where enrollment_year = $1", [year])
      if (taken.rowCount === 0) return year
    }
  })
}

function amounts(overrides: Partial<FeeAmounts> = {}): FeeAmounts {
  return {
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
    ...overrides,
  }
}

async function rows<T>(query: string, params: unknown[] = []): Promise<T[]> {
  return inRolledBackTransaction(async (sql) => (await sql.query(query, params)).rows as T[])
}

describe("saving a year's schedule", () => {
  test("the Accountant creates a schedule, and every staff member with payments.view reads it", async () => {
    const year = await unusedYear()
    const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), year, amounts())
    expect(saved).toEqual({ ok: true, data: null })

    for (const person of [ACCOUNTANT, MANAGER, ADMISSIONS]) {
      expect(await getFeeSchedule(await signedIn(person), year), person.roleName).toEqual({
        ok: true,
        data: { year, academicYearStart: null, seats: [], ...amounts() },
      })
    }
  })

  test("saving again replaces the amounts, split and due dates", async () => {
    const year = await unusedYear()
    const accountant = await signedIn(ACCOUNTANT)
    await saveFeeAmounts(accountant, year, amounts())

    const corrected = amounts({
      bands: { ...amounts().bands, secondary: { day: 2_900_000, boarding: 4_400_000 } },
      split: { first: 50, second: 30, third: 20 },
      dueDates: { first: "2026-12-01", second: "2027-03-15", third: "2027-07-01" },
      minimumDeposit: 250_000,
      preFormOne: { day: 460_000, boarding: 590_000 },
    })
    expect(await saveFeeAmounts(accountant, year, corrected)).toEqual({ ok: true, data: null })
    expect(await getFeeSchedule(accountant, year)).toEqual({ ok: true, data: { year, academicYearStart: null, seats: [], ...corrected } })
  })

  test("lists every year, newest first", async () => {
    const year = await unusedYear()
    const accountant = await signedIn(ACCOUNTANT)
    await saveFeeAmounts(accountant, year, amounts())

    const listed = await listFeeSchedules(await signedIn(ADMISSIONS))
    if (!listed.ok) throw new Error("not listed")
    const years = listed.data.map((schedule) => schedule.year)
    expect(years).toContain(year)
    expect(years).toContain(2027)
    expect(years).toEqual([...years].sort((a, b) => b - a))
  })

  test("a year with no schedule reads as not found", async () => {
    expect(await getFeeSchedule(await signedIn(ACCOUNTANT), await unusedYear())).toEqual({ ok: false, error: "not-found" })
  })
})

describe("refusals", () => {
  async function refused(changes: Partial<FeeAmounts> | ((a: FeeAmounts) => unknown), field: string) {
    const year = await unusedYear()
    const input = typeof changes === "function" ? changes(amounts()) : amounts(changes)
    expect(await saveFeeAmounts(await signedIn(ACCOUNTANT), year, input as FeeAmounts), field).toEqual({
      ok: false,
      error: { kind: "invalid", field },
    })
    expect(await getFeeSchedule(await signedIn(ACCOUNTANT), year), `${field} saved nothing`).toEqual({
      ok: false,
      error: "not-found",
    })
  }

  test("a split that doesn't add up to 100", async () => {
    await refused({ split: { first: 40, second: 40, third: 30 } }, "split")
    await refused({ split: { first: 30, second: 40, third: 20 } }, "split")
  })

  test("a share that isn't a whole percentage above zero", async () => {
    await refused({ split: { first: 0, second: 80, third: 20 } }, "first_share")
    await refused({ split: { first: 40.5, second: 39.5, third: 20 } }, "first_share")
  })

  test("a missing, zero or negative amount, naming the band and Day or Boarding", async () => {
    await refused((a) => ({ ...a, bands: { ...a.bands, nursery: { boarding: 3_000_000 } } }), "nursery.day_fee")
    await refused((a) => ({ ...a, bands: { ...a.bands, primary_upper: { day: 0, boarding: 1 } } }), "primary_upper.day_fee")
    await refused((a) => ({ ...a, bands: { ...a.bands, secondary: { day: 1, boarding: -5 } } }), "secondary.boarding_fee")
    await refused((a) => ({ ...a, bands: { nursery: a.bands.nursery } }), "primary_lower.day_fee")
    await refused((a) => ({ ...a, bands: { ...a.bands, nursery: { day: 1_100_000.5, boarding: 3_000_000 } } }), "nursery.day_fee")
  })

  test("a missing, zero or negative deposit or Pre-Form One fee", async () => {
    await refused({ minimumDeposit: 0 }, "minimum_deposit")
    await refused((a) => ({ ...a, minimumDeposit: undefined }), "minimum_deposit")
    await refused({ preFormOne: { day: -1, boarding: 580_000 } }, "pre_form_one_day_fee")
    await refused((a) => ({ ...a, preFormOne: { day: 450_000 } }), "pre_form_one_boarding_fee")
  })

  test("a missing due date, or one before the instalment ahead of it", async () => {
    await refused((a) => ({ ...a, dueDates: { ...a.dueDates, first: "" } }), "first_due")
    await refused((a) => ({ ...a, dueDates: { ...a.dueDates, second: "2027-02-30" } }), "second_due")
    await refused((a) => ({ ...a, dueDates: { ...a.dueDates, second: "2026-10-01" } }), "second_due")
    await refused((a) => ({ ...a, dueDates: { ...a.dueDates, third: "2027-03-01" } }), "third_due")
  })

  test("a year outside 2000 to 2999", async () => {
    expect(await saveFeeAmounts(await signedIn(ACCOUNTANT), 1999, amounts())).toEqual({
      ok: false,
      error: { kind: "invalid", field: "enrollment_year" },
    })
  })
})

describe("permissions", () => {
  test("the Admissions Manager and Admissions Staff can't change the amounts", async () => {
    const year = await unusedYear()
    for (const person of [MANAGER, ADMISSIONS]) {
      expect(await saveFeeAmounts(await signedIn(person), year, amounts()), person.roleName).toEqual({
        ok: false,
        error: { kind: "forbidden" },
      })
    }
    // Nor the seeded 2027 schedule.
    const before = await getFeeSchedule(await signedIn(MANAGER), 2027)
    expect((await saveFeeAmounts(await signedIn(MANAGER), 2027, amounts({ minimumDeposit: 1 }))).ok).toBe(false)
    expect(await getFeeSchedule(await signedIn(MANAGER), 2027)).toEqual(before)
    expect(await getFeeSchedule(await signedIn(ACCOUNTANT), year)).toEqual({ ok: false, error: "not-found" })
  })

  test("someone signed out sees no schedule and can't save one; nor can the secret key", async () => {
    const anon = anonClient()
    expect(await listFeeSchedules(anon)).toEqual({ ok: true, data: [] })
    expect(await getFeeSchedule(anon, 2027)).toEqual({ ok: false, error: "not-found" })
    const { data: bands } = await anon.from("fee_band_amounts").select("id")
    expect(bands).toEqual([])

    const year = await unusedYear()
    for (const client of [anon, secretClient()]) {
      expect((await saveFeeAmounts(client, year, amounts())).ok).toBe(false)
    }
    expect(await getFeeSchedule(await signedIn(ACCOUNTANT), year)).toEqual({ ok: false, error: "not-found" })
  })

  test("nobody writes the tables directly, through the API", async () => {
    const accountant = await signedIn(ACCOUNTANT)
    const insert = await accountant.from("fee_schedules").insert({
      enrollment_year: await unusedYear(),
      first_due: "2026-11-01",
      second_due: "2027-04-01",
      third_due: "2027-06-01",
      minimum_deposit: 1,
      pre_form_one_day_fee: 1,
      pre_form_one_boarding_fee: 1,
    })
    expect(insert.error).not.toBeNull()
    const update = await accountant.from("fee_band_amounts").update({ day_fee: 1 }).eq("enrollment_year", 2027)
    expect(update.error).not.toBeNull()
    const remove = await accountant.from("fee_schedules").delete().eq("enrollment_year", 2027)
    expect(remove.error).not.toBeNull()
    expect((await getFeeSchedule(accountant, 2027)).ok).toBe(true)
  })

  test("schedules and band amounts are never deleted, even by the database owner", async () => {
    const year = await unusedYear()
    await saveFeeAmounts(await signedIn(ACCOUNTANT), year, amounts())

    for (const table of ["fee_band_amounts", "fee_schedules"]) {
      await expect(
        asSystem((sql) => sql.query(`delete from public.${table} where enrollment_year = $1`, [year])),
        table,
      ).rejects.toThrow(/delete_refused/)
    }
    expect((await getFeeSchedule(await signedIn(ACCOUNTANT), year)).ok).toBe(true)
  })
})

describe("class bands", () => {
  test("every class falls in the band the school's fee schedule gives it", async () => {
    const accountant = await signedIn(ACCOUNTANT)
    for (const className of LEAD_CLASSES) {
      const { data, error } = await accountant.rpc("fee_band_of", { class_name: className })
      expect(error).toBeNull()
      const expected = FEE_BANDS.find((band) => BAND_CLASSES[band].includes(className))
      expect(data, className).toBe(expected)
    }
    expect(FEE_BANDS.flatMap((band) => BAND_CLASSES[band])).toEqual([...LEAD_CLASSES])
  })
})

describe("history", () => {
  test("creating and correcting a schedule is recorded with the Accountant, and the old and new values", async () => {
    const year = await unusedYear()
    const accountant = await signedIn(ACCOUNTANT)
    await saveFeeAmounts(accountant, year, amounts())
    await saveFeeAmounts(
      accountant,
      year,
      amounts({ minimumDeposit: 350_000, bands: { ...amounts().bands, nursery: { day: 1_200_000, boarding: 3_000_000 } } }),
    )

    const entries = await rows<{ table_name: string; action: string; old_values: unknown; new_values: Record<string, unknown>; name: string; scope: string; lead_id: string | null }>(
      `select a.table_name, a.action, a.old_values, a.new_values, s.full_name as name, a.scope, a.lead_id
       from public.audit_log a
       join public.staff_members s on s.id = a.actor_staff_id
       where a.table_name in ('fee_schedules', 'fee_band_amounts')
         and (a.row_id in (select id from public.fee_schedules where enrollment_year = $1)
              or a.row_id in (select id from public.fee_band_amounts where enrollment_year = $1))
       order by a.id`,
      [year],
    )

    expect(entries.every((e) => e.name === ACCOUNTANT.name && e.scope === "payment" && e.lead_id === null)).toBe(true)
    expect(entries.filter((e) => e.action === "insert").map((e) => e.table_name).sort()).toEqual([
      "fee_band_amounts",
      "fee_band_amounts",
      "fee_band_amounts",
      "fee_band_amounts",
      "fee_schedules",
    ])
    expect(entries.filter((e) => e.action === "update").map(({ table_name, old_values, new_values }) => ({ table_name, old_values, new_values }))).toEqual([
      { table_name: "fee_schedules", old_values: { minimum_deposit: 300_000 }, new_values: { minimum_deposit: 350_000 } },
      { table_name: "fee_band_amounts", old_values: { day_fee: 1_100_000 }, new_values: { day_fee: 1_200_000 } },
    ])

    // Staff who may view payments read it; the history is not theirs otherwise.
    const visible = await (await signedIn(ADMISSIONS))
      .from("audit_log")
      .select("id")
      .eq("table_name", "fee_schedules")
      .limit(1)
    expect(visible.data?.length).toBe(1)
    const hidden = await anonClient().from("audit_log").select("id").eq("table_name", "fee_schedules")
    expect(hidden.data ?? []).toEqual([])
  })
})
