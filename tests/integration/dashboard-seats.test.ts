import { describe, expect, test } from "vitest"

import { getSeatsByClass, type ClassSeatFigures, type SeatsByClass } from "@/lib/services/dashboard"
import { LEAD_CLASSES } from "@/lib/services/leads"

import { anonClient, asSystem, createThrowawayStaff, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Seats by class against local Supabase, for Enrollment year 2031, the
// dashboard's own fixtures in supabase/seeds/95_dashboard.sql. Its header
// lists the seats Test Manager set and the leads holding them.

const YEAR = 2031

async function seats2031(): Promise<SeatsByClass> {
  const result = await getSeatsByClass(await signedIn(MANAGER), YEAR)
  if (!result.ok) throw new Error(`seats refused: ${result.error}`)
  return result.data
}

function row(seats: SeatsByClass, className: string, dayOrBoarding: string): ClassSeatFigures {
  const found = seats.classes.find((entry) => entry.className === className && entry.dayOrBoarding === dayOrBoarding)
  if (!found) throw new Error(`no row for ${className} ${dayOrBoarding}`)
  return found
}

describe("Seats by class", () => {
  test("lists every class, Day before Boarding, in class order", async () => {
    const seats = await seats2031()
    expect(seats.year).toBe(YEAR)
    expect(seats.classes.map((entry) => `${entry.className} ${entry.dayOrBoarding}`)).toEqual(
      LEAD_CLASSES.flatMap((className) => [`${className} Day`, `${className} Boarding`]),
    )
  })

  test("shows the seats set, the seats taken by Seat priority, and the seats left", async () => {
    const seats = await seats2031()
    expect(row(seats, "STD 3", "Day")).toEqual({
      className: "STD 3",
      dayOrBoarding: "Day",
      seats: 3,
      taken: 2,
      full: 1,
      firstInstalment: 1,
      deposit: 0,
      left: 1,
      overBy: null,
    })
    expect(row(seats, "STD 2", "Boarding")).toMatchObject({ seats: 5, taken: 0, left: 5, overBy: null })
  })

  test("an over-full class is over by how many, never a negative number left", async () => {
    const seats = await seats2031()
    expect(row(seats, "STD 2", "Day")).toEqual({
      className: "STD 2",
      dayOrBoarding: "Day",
      seats: 3,
      taken: 4,
      full: 2,
      firstInstalment: 1,
      deposit: 1,
      left: 0,
      overBy: 1,
    })
  })

  test("a class with no seat number is not set, with its taken seats still counted", async () => {
    const seats = await seats2031()
    expect(row(seats, "STD 4", "Day")).toEqual({
      className: "STD 4",
      dayOrBoarding: "Day",
      seats: null,
      taken: 3,
      full: 3,
      firstInstalment: 0,
      deposit: 0,
      left: null,
      overBy: null,
    })
    expect(row(seats, "FORM 4", "Boarding")).toMatchObject({ seats: null, taken: 0, left: null, overBy: null })
  })

  test("a Declined lead frees its seat and an Archived one keeps it", async () => {
    // ADMSN-31024 (STD 3 Day) and ADMSN-31025 (STD 4 Day) both paid in full;
    // one was Declined since, the other Archived.
    const leads = await asSystem(
      async (sql) =>
        (
          await sql.query<{ admission_number: string; status: string; closure: string | null; priority: string | null }>(
            `select l.admission_number, l.status, l.closure, (public.lead_seat_priority(l.id)).priority::text as priority
             from public.leads l where l.admission_number in ('ADMSN-31024', 'ADMSN-31025') order by 1`,
          )
        ).rows,
    )
    expect(leads).toEqual([
      { admission_number: "ADMSN-31024", status: "Declined", closure: null, priority: "Full" },
      { admission_number: "ADMSN-31025", status: "Enrolled", closure: "Archived", priority: "Full" },
    ])

    const seats = await seats2031()
    // STD 3 Day: ADMSN-31018 and ADMSN-31021; not ADMSN-31024.
    expect(row(seats, "STD 3", "Day")).toMatchObject({ taken: 2, full: 1 })
    // STD 4 Day: ADMSN-31019, ADMSN-31022 and the Archived ADMSN-31025.
    expect(row(seats, "STD 4", "Day")).toMatchObject({ taken: 3, full: 3 })
  })

  test("opens on the latest year with a Fee schedule, and offers every year that has one", async () => {
    const result = await getSeatsByClass(await signedIn(MANAGER))
    if (!result.ok) throw new Error(`seats refused: ${result.error}`)
    const { year, years } = result.data
    expect(years).toContain(YEAR)
    expect(years).toContain(2027)
    expect(years).toEqual([...years].sort((a, b) => b - a))
    expect(year).toBe(years[0])
  })

  test("a year with no Fee schedule falls back to the latest that has one", async () => {
    const result = await getSeatsByClass(await signedIn(MANAGER), 1999)
    if (!result.ok) throw new Error(`seats refused: ${result.error}`)
    expect(result.data.years).not.toContain(1999)
    expect(result.data.year).toBe(result.data.years[0])
  })

  test("names no lead", async () => {
    const result = await getSeatsByClass(await signedIn(MANAGER), YEAR)
    const text = JSON.stringify(result)
    expect(text).not.toMatch(/Takwimu|ADMSN-|1ead2031|ranked|leadId|studentName/)
  })

  test("Admissions Staff and the Accountant see the same figures as the Manager", async () => {
    const manager = await seats2031()
    for (const person of [ADMISSIONS, ACCOUNTANT]) {
      const result = await getSeatsByClass(await signedIn(person), YEAR)
      if (!result.ok) throw new Error(`seats refused: ${result.error}`)
      expect(result.data.year).toBe(YEAR)
      expect(result.data.classes).toEqual(manager.classes)
    }
  })
})

describe("who may read Seats by class", () => {
  test("a role without payments.view is refused", async () => {
    const reader = await createThrowawayStaff(["leads.view"])
    expect(await getSeatsByClass(await signedIn(reader), YEAR)).toEqual({ ok: false, error: "forbidden" })
  })

  test("a visitor who is not signed in is refused", async () => {
    expect(await getSeatsByClass(anonClient(), YEAR)).toEqual({ ok: false, error: "forbidden" })
  })
})
