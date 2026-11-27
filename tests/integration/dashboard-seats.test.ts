import { describe, expect, test } from "vitest"

import { defaultSeatsYear, tanzaniaToday } from "@/lib/school-calendar"
import { getSeatFiguresByClass, getSeatsByClass, type ClassStreamFigures, type SeatsByClass } from "@/lib/services/dashboard"
import type { ClassStreams } from "@/lib/services/streams"

import { anonClient, asSystem, createThrowawayStaff, signedIn } from "../support/db"
import { ACCOUNTANT, ADMISSIONS, MANAGER } from "../support/fixtures"

// Seats by class against local Supabase, for Enrollment year 2031, the
// dashboard's own fixtures in supabase/seeds/95_dashboard.sql. Its header
// lists the 2031 streams and the leads placed in them. Seats are counted in
// streams since the activation migration (#449): Reports asks for the counts
// by stream (getSeatFiguresByClass), and Home for the year's streams as Seats
// reads them (getSeatsByClass).

const YEAR = 2031

async function figures2031(person = MANAGER): Promise<ClassStreamFigures[]> {
  const result = await getSeatFiguresByClass(await signedIn(person), YEAR)
  if (!result.ok) throw new Error(`seats refused: ${result.error}`)
  return result.data.classes
}

function entry(classes: ClassStreamFigures[], className: string): ClassStreamFigures {
  const found = classes.find((each) => each.className === className)
  if (!found) throw new Error(`no entry for ${className}`)
  return found
}

async function home2031(): Promise<SeatsByClass> {
  const result = await getSeatsByClass(await signedIn(MANAGER), YEAR)
  if (!result.ok) throw new Error(`seats refused: ${result.error}`)
  return result.data
}

function streamsOf(seats: SeatsByClass, className: string): ClassStreams {
  const found = seats.streams?.classes.find((each) => each.className === className)
  if (!found) throw new Error(`no streams for ${className}`)
  return found
}

describe("Seats by class, for Reports", () => {
  test("lists the classes with a stream or a seat holder, in class order, and no Day or Boarding rows", async () => {
    const result = await getSeatFiguresByClass(await signedIn(MANAGER), YEAR)
    if (!result.ok) throw new Error(`seats refused: ${result.error}`)
    expect(result.data.year).toBe(YEAR)
    expect(Object.keys(result.data).sort()).toEqual(["classes", "year", "years"])
    const fixtures = ["STD 2", "STD 3", "STD 4"]
    expect(result.data.classes.map((each) => each.className).filter((name) => fixtures.includes(name))).toEqual(fixtures)
  })

  test("shows each stream's seats, the children placed in it by Seat priority, and its free seats", async () => {
    const classes = await figures2031()
    expect(entry(classes, "STD 3")).toEqual({
      className: "STD 3",
      streams: [{ id: expect.any(String), label: "A", takes: "Mixed", seats: 3, full: 1, firstInstalment: 1, deposit: 0, free: 1 }],
      full: 1,
      firstInstalment: 1,
      deposit: 0,
      waiting: 0,
    })
  })

  test("a full class counts who waits for a stream, with the class's seat holders placed or not", async () => {
    const classes = await figures2031()
    // Four hold a Seat priority and STD 2 A has three seats: the Deposit
    // child ranks last and waits.
    expect(entry(classes, "STD 2")).toEqual({
      className: "STD 2",
      streams: [{ id: expect.any(String), label: "A", takes: "Mixed", seats: 3, full: 2, firstInstalment: 1, deposit: 0, free: 0 }],
      full: 2,
      firstInstalment: 1,
      deposit: 1,
      waiting: 1,
    })
  })

  test("a class with no stream has no limit: its seat holders are counted and nobody waits", async () => {
    const classes = await figures2031()
    expect(entry(classes, "STD 4")).toEqual({ className: "STD 4", streams: [], full: 3, firstInstalment: 0, deposit: 0, waiting: 0 })
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

    const classes = await figures2031()
    // STD 3 A: ADMSN-31018 and ADMSN-31021; not ADMSN-31024.
    expect(entry(classes, "STD 3")).toMatchObject({ full: 1, firstInstalment: 1 })
    // STD 4: ADMSN-31019, ADMSN-31022 and the Archived ADMSN-31025.
    expect(entry(classes, "STD 4")).toMatchObject({ full: 3 })
  })

  test("names no lead", async () => {
    const result = await getSeatFiguresByClass(await signedIn(MANAGER), YEAR)
    const text = JSON.stringify(result)
    expect(text).not.toMatch(/Takwimu|ADMSN-|1ead2031|ranked|leadId|studentName/)
  })

  test("Admissions Staff and the Accountant see the same figures as the Manager", async () => {
    const manager = await figures2031()
    for (const person of [ADMISSIONS, ACCOUNTANT]) expect(await figures2031(person)).toEqual(manager)
  })
})

describe("Seats by class, for Home", () => {
  test("reads the year's streams as Seats does: seats, children placed, whether a seat is free, and who waits", async () => {
    const seats = await home2031()
    expect(seats.year).toBe(YEAR)

    const full = streamsOf(seats, "STD 2")
    expect(full.streams).toEqual([expect.objectContaining({ label: "A", takes: "Mixed", seats: 3, placed: 3 })])
    expect(full).toMatchObject({ freeForBoy: false, freeForGirl: false, freeForAny: false })
    expect(full.waiting.map((child) => child.admissionNumber)).toEqual(["ADMSN-31023"])

    const room = streamsOf(seats, "STD 3")
    expect(room.streams).toEqual([expect.objectContaining({ label: "A", seats: 3, placed: 2 })])
    expect(room).toMatchObject({ freeForAny: true, waiting: [] })

    // Only classes with streams are listed; STD 4 has none, so no limit.
    expect(seats.streams?.classes.map((each) => each.className)).not.toContain("STD 4")
  })

  test("reads the same counts by stream as Reports, for the Seats chart's paid and part-paid seats", async () => {
    const seats = await home2031()
    expect(seats.figures).toEqual(await figures2031())
    // STD 3 A: one child paid in full and one a First instalment, so one seat free.
    expect(entry(seats.figures ?? [], "STD 3").streams).toEqual([expect.objectContaining({ seats: 3, full: 1, firstInstalment: 1, deposit: 0, free: 1 })])
  })
})

describe("the year shown", () => {
  test("opens on the default seats year for the current admission year, and offers every year with a Fee schedule", async () => {
    const today = tanzaniaToday()
    for (const read of [getSeatsByClass, getSeatFiguresByClass]) {
      const result = await read(await signedIn(MANAGER), null, today)
      if (!result.ok) throw new Error(`seats refused: ${result.error}`)
      const { year, years } = result.data
      expect(years).toContain(YEAR)
      expect(years).toContain(2027)
      expect(years).toEqual([...years].sort((a, b) => b - a))
      expect(year).toBe(defaultSeatsYear(years, today))
    }
  })

  test("a year with no Fee schedule falls back to the default seats year", async () => {
    const today = tanzaniaToday()
    const result = await getSeatsByClass(await signedIn(MANAGER), 1999, today)
    if (!result.ok) throw new Error(`seats refused: ${result.error}`)
    expect(result.data.years).not.toContain(1999)
    expect(result.data.year).toBe(defaultSeatsYear(result.data.years, today))
  })
})

describe("who may read Seats by class", () => {
  test("a role without payments.view is refused", async () => {
    const reader = await createThrowawayStaff(["leads.view"])
    expect(await getSeatsByClass(await signedIn(reader), YEAR)).toEqual({ ok: false, error: "forbidden" })
    expect(await getSeatFiguresByClass(await signedIn(reader), YEAR)).toEqual({ ok: false, error: "forbidden" })
  })

  test("a visitor who is not signed in is refused", async () => {
    expect(await getSeatsByClass(anonClient(), YEAR)).toEqual({ ok: false, error: "forbidden" })
    expect(await getSeatFiguresByClass(anonClient(), YEAR)).toEqual({ ok: false, error: "forbidden" })
  })
})
