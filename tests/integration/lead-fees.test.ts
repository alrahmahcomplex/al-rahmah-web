import { randomInt, randomUUID } from "node:crypto"

import { describe, expect, onTestFinished, test } from "vitest"

import { tanzaniaToday } from "@/lib/school-calendar"
import { BAND_CLASSES, FEE_BANDS, getFeeSchedule, saveFeeAmounts, type FeeAmounts, type FeeSchedule } from "@/lib/services/fees"
import { getLeadFee, type LeadFee } from "@/lib/services/lead-fees"
import { createLead, updateLeadDetails, type DayOrBoarding, type LeadClass } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, inRolledBackTransaction, secretClient, signedIn } from "../support/db"
import { claimFeeYear, noScheduleYear } from "../support/fee-years"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// A lead's School fee through the lead fee module, against local Supabase,
// signed in as each seeded role. A test that needs a schedule claims a year of
// its own and saves one (tests/support/fee-years.ts), so no test shares a fee;
// "no schedule" cases share the one year no test schedules.

const thisYear = Number(tanzaniaToday().slice(0, 4))

// A year of the test's own, claimed until the test finishes. It may hold a
// schedule an earlier run saved, so a test that needs one saves its own.
async function claimedYear(): Promise<number> {
  const claim = await claimFeeYear()
  onTestFinished(claim.release)
  return claim.year
}

function amounts(overrides: Partial<FeeAmounts> = {}): FeeAmounts {
  return {
    bands: {
      nursery: { day: 1_100_000, boarding: 3_000_000 },
      primary_lower: { day: 2_000_000, boarding: 3_100_000 },
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

// A year with a schedule of its own.
async function yearWithSchedule(overrides: Partial<FeeAmounts> = {}): Promise<number> {
  const year = await claimedYear()
  const saved = await saveFeeAmounts(await signedIn(ACCOUNTANT), year, amounts(overrides))
  if (!saved.ok) throw new Error(`setup failed: ${JSON.stringify(saved.error)}`)
  return year
}

function phone() {
  // A leading 7 keeps it clear of the seeded 700 000 numbers.
  return `07${String(randomInt(0, 100_000_000)).padStart(8, "0")}`
}

// A walk-in lead, moved into `year` the way a lead made in an earlier year
// holds a year the screen no longer offers.
async function lead(year: number, className: LeadClass = "STD 2", dayOrBoarding: DayOrBoarding = "Day"): Promise<string> {
  const created = await createLead(await signedIn(ADMISSIONS), {
    guardian: { contact: { fullName: "Test Parent", relationship: "Mother", phone: phone() } },
    student: { fullName: `Pupil ${randomUUID().slice(0, 8)}`, className, enrollmentYear: thisYear + 1, dayOrBoarding },
    start: { kind: "walk-in", visitDate: tanzaniaToday() },
  })
  if (!created.ok) throw new Error(`setup failed: ${JSON.stringify(created.error)}`)
  await asSystem((sql) =>
    sql.query("update public.leads set enrollment_year = $2 where id = $1", [created.data.leadId, year]),
  )
  return created.data.leadId
}

// What the lead fee module should answer for a fee, its schedule and its 40/40/20-style split.
function expectedFee(schedule: Pick<FeeSchedule, "split" | "dueDates">, year: number, band: (typeof FEE_BANDS)[number], dayOrBoarding: DayOrBoarding, fee: number): LeadFee {
  const first = Math.round((fee * schedule.split.first) / 100)
  const second = Math.round((fee * schedule.split.second) / 100)
  return {
    kind: "fee",
    year,
    band,
    dayOrBoarding,
    schoolFee: fee,
    totalPaid: 0,
    balance: fee,
    instalments: [
      { amount: first, due: schedule.dueDates.first },
      { amount: second, due: schedule.dueDates.second },
      { amount: fee - first - second, due: schedule.dueDates.third },
    ],
    priority: null,
    priorityReachedOn: null,
  }
}

describe("the School fee", () => {
  test("is the band fee for the lead's class and Day or boarding, in every band", async () => {
    const year = await yearWithSchedule()
    const staff = await signedIn(ADMISSIONS)
    for (const band of FEE_BANDS) {
      for (const dayOrBoarding of ["Day", "Boarding"] as const) {
        const className = BAND_CLASSES[band][BAND_CLASSES[band].length - 1]
        const id = await lead(year, className, dayOrBoarding)
        const fee = amounts().bands[band][dayOrBoarding === "Day" ? "day" : "boarding"]
        expect(await getLeadFee(staff, id), `${className} ${dayOrBoarding}`).toEqual({
          ok: true,
          data: expectedFee(amounts(), year, band, dayOrBoarding, fee),
        })
      }
    }
  })

  test("splits 40/40/20 into instalments with their due dates", async () => {
    const year = await yearWithSchedule()
    const fee = await getLeadFee(await signedIn(ADMISSIONS), await lead(year, "KG 1", "Day"))
    expect(fee.ok && fee.data.kind === "fee" && fee.data.instalments).toEqual([
      { amount: 440_000, due: "2026-11-01" },
      { amount: 440_000, due: "2027-04-01" },
      { amount: 220_000, due: "2027-06-01" },
    ])
  })

  test("instalments round to the whole shilling and still add up to the fee exactly", async () => {
    // 1,000,003 at 33/33/34: 330,000.99 rounds up twice, so the third takes
    // what is left.
    const year = await yearWithSchedule({
      bands: { ...amounts().bands, primary_upper: { day: 1_000_003, boarding: 1_234_567 } },
      split: { first: 33, second: 33, third: 34 },
    })
    const staff = await signedIn(ADMISSIONS)

    const day = await getLeadFee(staff, await lead(year, "STD 6", "Day"))
    expect(day.ok && day.data.kind === "fee" && day.data.instalments.map((i) => i.amount)).toEqual([
      330_001, 330_001, 340_001,
    ])

    // 1,234,567 at 33%: 407,407.11 rounds down.
    const boarding = await getLeadFee(staff, await lead(year, "STD 6", "Boarding"))
    expect(boarding.ok && boarding.data.kind === "fee" && boarding.data.instalments.map((i) => i.amount)).toEqual([
      407_407, 407_407, 419_753,
    ])
  })

  test("a lead whose year has no schedule gets a no-schedule answer naming the year, and no amount", async () => {
    const year = await noScheduleYear()
    expect(await getLeadFee(await signedIn(ADMISSIONS), await lead(year))).toEqual({
      ok: true,
      data: { kind: "no-schedule", year },
    })
  })

  test("is the lead's own year's: another year's schedule never changes it", async () => {
    const year = await yearWithSchedule()
    const other = await yearWithSchedule({
      bands: { ...amounts().bands, primary_lower: { day: 9_000_000, boarding: 9_500_000 } },
    })
    const staff = await signedIn(ADMISSIONS)
    const mine = await getLeadFee(staff, await lead(year, "STD 2", "Day"))
    const theirs = await getLeadFee(staff, await lead(other, "STD 2", "Day"))
    expect(mine.ok && mine.data.kind === "fee" && mine.data.schoolFee).toBe(2_000_000)
    expect(theirs.ok && theirs.data.kind === "fee" && theirs.data.schoolFee).toBe(9_000_000)
  })

  test("a lead that does not exist is not found", async () => {
    const staff = await signedIn(ADMISSIONS)
    expect(await getLeadFee(staff, randomUUID())).toEqual({ ok: false, error: "not-found" })
    expect(await getLeadFee(staff, "not-a-lead")).toEqual({ ok: false, error: "not-found" })
  })
})

describe("correcting the lead", () => {
  test("a corrected class or Day or boarding changes the fee straight away", async () => {
    const year = await yearWithSchedule()
    const id = await lead(year, "STD 2", "Day")
    const staff = await signedIn(ADMISSIONS)

    expect((await updateLeadDetails(staff, id, { className: "FORM 3" })).ok).toBe(true)
    expect(await getLeadFee(staff, id)).toEqual({
      ok: true,
      data: expectedFee(amounts(), year, "secondary", "Day", 2_800_000),
    })

    expect((await updateLeadDetails(staff, id, { dayOrBoarding: "Boarding" })).ok).toBe(true)
    expect(await getLeadFee(staff, id)).toEqual({
      ok: true,
      data: expectedFee(amounts(), year, "secondary", "Boarding", 4_300_000),
    })
  })

  test("a corrected enrollment year takes that year's schedule, or none", async () => {
    const id = await lead(await yearWithSchedule(), "STD 5", "Boarding")
    const staff = await signedIn(ADMISSIONS)

    // The years the screen offers; some may hold a schedule, some not.
    for (const year of [thisYear, thisYear + 1, thisYear + 2]) {
      expect((await updateLeadDetails(staff, id, { enrollmentYear: year })).ok, String(year)).toBe(true)
      const schedule = await getFeeSchedule(staff, year)
      expect(await getLeadFee(staff, id), String(year)).toEqual({
        ok: true,
        data: schedule.ok
          ? expectedFee(schedule.data, year, "primary_upper", "Boarding", schedule.data.bands.primary_upper.boarding)
          : { kind: "no-schedule", year },
      })
    }
  })

  test("a corrected schedule changes the fee straight away", async () => {
    const year = await yearWithSchedule()
    const id = await lead(year, "DAY CARE", "Day")
    await saveFeeAmounts(await signedIn(ACCOUNTANT), year, amounts({
      bands: { ...amounts().bands, nursery: { day: 1_150_000, boarding: 3_000_000 } },
    }))
    const fee = await getLeadFee(await signedIn(ADMISSIONS), id)
    expect(fee.ok && fee.data.kind === "fee" && fee.data.schoolFee).toBe(1_150_000)
  })
})

describe("who sees it", () => {
  test("every seeded role with payments.view reads the same fee", async () => {
    const year = await yearWithSchedule()
    const id = await lead(year, "STD 3", "Boarding")
    for (const person of [ACCOUNTANT, MANAGER, ADMISSIONS]) {
      expect(await getLeadFee(await signedIn(person), id), person.roleName).toEqual({
        ok: true,
        data: expectedFee(amounts(), year, "primary_lower", "Boarding", 3_100_000),
      })
    }
  })

  test("a staff member without payments.view is refused", async () => {
    const id = await lead(await yearWithSchedule())
    const viewer = await createThrowawayStaff(["leads.view"])
    expect(await getLeadFee(await signedIn(viewer), id)).toEqual({ ok: false, error: "forbidden" })
  })

  test("someone signed out sees nothing, and nor does the secret key", async () => {
    const id = await lead(await yearWithSchedule())
    expect(await getLeadFee(anonClient(), id)).toEqual({ ok: false, error: "forbidden" })
    expect(await getLeadFee(secretClient(), id)).toEqual({ ok: false, error: "forbidden" })
    const { data } = await anonClient().from("lead_fee_profiles").select("id")
    expect(data ?? []).toEqual([])
  })
})

describe("the lead fee profile", () => {
  test("is readable with leads.view, written by nobody through the API, and never deleted", async () => {
    const id = await lead(await noScheduleYear())
    // Later tickets write it through their functions; here the owner stands in.
    await asSystem((sql) =>
      sql.query(
        "insert into public.lead_fee_profiles (lead_id, prior_sibling, prior_sibling_name, prior_sibling_class) values ($1, true, 'Elder Fixture', 'STD 4')",
        [id],
      ),
    )

    const staff = await signedIn(ADMISSIONS)
    const { data } = await staff.from("lead_fee_profiles").select("lead_id, prior_sibling, sibling_kept").eq("lead_id", id)
    expect(data).toEqual([{ lead_id: id, prior_sibling: true, sibling_kept: false }])
    expect((await anonClient().from("lead_fee_profiles").select("id").eq("lead_id", id)).data ?? []).toEqual([])

    expect((await staff.from("lead_fee_profiles").update({ sibling_kept: true }).eq("lead_id", id)).error).not.toBeNull()
    expect((await staff.from("lead_fee_profiles").insert({ lead_id: await lead(await noScheduleYear()) })).error).not.toBeNull()
    expect((await staff.from("lead_fee_profiles").delete().eq("lead_id", id)).error).not.toBeNull()
    await expect(
      asSystem((sql) => sql.query("delete from public.lead_fee_profiles where lead_id = $1", [id])),
    ).rejects.toThrow(/delete_refused/)

    // Its history is the lead's.
    const history = await inRolledBackTransaction(async (sql) =>
      (
        await sql.query(
          "select scope, lead_id, action from public.audit_log where table_name = 'lead_fee_profiles' and lead_id = $1",
          [id],
        )
      ).rows,
    )
    expect(history).toEqual([{ scope: "lead", lead_id: id, action: "insert" }])
  })

  test("holds one row per lead, and a prior sibling only with a name and class", async () => {
    const id = await lead(await noScheduleYear())
    await asSystem((sql) => sql.query("insert into public.lead_fee_profiles (lead_id) values ($1)", [id]))
    await expect(
      asSystem((sql) => sql.query("insert into public.lead_fee_profiles (lead_id) values ($1)", [id])),
    ).rejects.toThrow(/duplicate key/)

    const other = await lead(await noScheduleYear())
    await expect(
      asSystem((sql) => sql.query("insert into public.lead_fee_profiles (lead_id, prior_sibling) values ($1, true)", [other])),
    ).rejects.toThrow(/check constraint/)
  })
})
