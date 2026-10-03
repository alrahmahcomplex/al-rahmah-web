import { describe, expect, onTestFinished, test } from "vitest"

import { getFeeSchedule, saveFeeAmounts, type FeeAmounts } from "@/lib/services/fees"

import { signedIn } from "../support/db"
import { claimFeeYear, FEE_YEARS, NO_SCHEDULE_YEAR, noScheduleYear } from "../support/fee-years"
import { ACCOUNTANT } from "../support/fixtures"

// The School fee tests' year allocator. The lock tests use a private key range
// of their own, far from any real year, so other test files claiming years at
// the same time can't take the keys these tests count on.

const PRIVATE = { first: 9101, last: 9103 }

async function claim(range = PRIVATE) {
  const held = await claimFeeYear(range)
  onTestFinished(held.release)
  return held
}

function amounts(nurseryDay: number): FeeAmounts {
  return {
    bands: {
      nursery: { day: nurseryDay, boarding: 3_000_000 },
      primary_lower: { day: 2_000_000, boarding: 3_100_000 },
      primary_upper: { day: 2_100_000, boarding: 3_300_000 },
      secondary: { day: 2_800_000, boarding: 4_300_000 },
    },
    split: { first: 40, second: 40, third: 20 },
    dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
    minimumDeposit: 300_000,
    preFormOne: { day: 450_000, boarding: 580_000 },
  }
}

describe("claiming a fee test year", () => {
  test("claims made at once never share a year", async () => {
    const held = await Promise.all([claim(), claim(), claim()])
    expect(new Set(held.map((h) => h.year)).size).toBe(3)
  })

  test("fails straight away, rather than waiting, when every year is claimed", async () => {
    await Promise.all([claim(), claim(), claim()])
    const started = Date.now()
    await expect(claimFeeYear(PRIVATE)).rejects.toThrow(/Every fee test year from 9101 to 9103 is claimed/)
    expect(Date.now() - started).toBeLessThan(5_000)
  })

  test("a released year can be claimed again", async () => {
    const [first] = await Promise.all([claimFeeYear(PRIVATE), claim(), claim()])
    await expect(claimFeeYear(PRIVATE)).rejects.toThrow(/is claimed/)
    await first.release()
    await first.release()
    expect((await claim()).year).toBe(first.year)
  })

  test("hands out years in the shared range, never the no-schedule year", async () => {
    const { year } = await claim(FEE_YEARS)
    expect(year).toBeGreaterThanOrEqual(FEE_YEARS.first)
    expect(year).toBeLessThanOrEqual(FEE_YEARS.last)
    expect(year).not.toBe(NO_SCHEDULE_YEAR)
  })

  test("a year an earlier run left a schedule in is reused: saving replaces that schedule", async () => {
    const { year } = await claim(FEE_YEARS)
    const accountant = await signedIn(ACCOUNTANT)
    // The first save stands in for whatever an earlier run left.
    expect((await saveFeeAmounts(accountant, year, amounts(1_100_000))).ok).toBe(true)
    expect((await saveFeeAmounts(accountant, year, amounts(1_234_000))).ok).toBe(true)
    const schedule = await getFeeSchedule(accountant, year)
    expect(schedule.ok && schedule.data.bands.nursery.day).toBe(1_234_000)
  })

  test("the no-schedule year has no schedule", async () => {
    expect(await noScheduleYear()).toBe(NO_SCHEDULE_YEAR)
    expect(await getFeeSchedule(await signedIn(ACCOUNTANT), NO_SCHEDULE_YEAR)).toEqual({ ok: false, error: "not-found" })
  })
})
