import { describe, expect, it } from "vitest"

import { overfillWarning } from "@/app/staff/leads/[id]/payment-outcome"
import { navFor, STAFF_NAV } from "@/app/staff/navigation"
import { defaultSeatsYear, seatsLine, takenLine } from "@/app/staff/seats/format"
import type { ClassSeats } from "@/lib/services/seats"

const PREVIEW = {
  schoolFee: 3_000_000,
  totalPaid: 0,
  totalPaidAfter: 300_000,
  balanceAfter: 2_700_000,
  priority: null,
  priorityAfter: "Deposit" as const,
  seats: 2,
  seatsTaken: 2,
  wouldOverfill: true,
}

describe("overfillWarning", () => {
  it("says the class is full, how full, and that the payment can still be recorded", () => {
    expect(overfillWarning(PREVIEW)).toBe(
      "This lead's class is full: 2 seats, 2 taken. This payment gives the lead a Seat priority, so the class will " +
        "have more leads than seats. You can still record it; tell the Admissions Manager.",
    )
    expect(overfillWarning({ ...PREVIEW, seats: 1, seatsTaken: 3 })).toContain("1 seat, 3 taken")
  })

  it("says nothing when the payment wouldn't overfill the class", () => {
    expect(overfillWarning({ ...PREVIEW, wouldOverfill: false })).toBeNull()
  })
})

const CLASS: ClassSeats = {
  className: "KG 2",
  dayOrBoarding: "Boarding",
  seats: 2,
  taken: 3,
  full: 1,
  firstInstalment: 0,
  deposit: 2,
  ranked: null,
}

describe("the Seats screen's lines", () => {
  it("shows the seats set, or Seats not set", () => {
    expect(seatsLine(CLASS)).toBe("2")
    expect(seatsLine({ ...CLASS, seats: null })).toBe("Seats not set")
  })

  it("splits the seats taken by Seat priority, leaving out empty ones", () => {
    expect(takenLine(CLASS)).toBe("Full 1 · Deposit 2")
    expect(takenLine({ ...CLASS, taken: 0, full: 0, deposit: 0 })).toBe("")
  })
})

describe("defaultSeatsYear", () => {
  it("opens the latest year with a schedule up to next year, the one admissions are for", () => {
    expect(defaultSeatsYear([2026, 2027, 2028], "2026-10-06")).toBe(2027)
    expect(defaultSeatsYear([2025, 2027], "2026-10-06")).toBe(2027)
    expect(defaultSeatsYear([2024, 2025], "2026-10-06")).toBe(2025)
    // Only later years: the earliest of them.
    expect(defaultSeatsYear([2030, 2029], "2026-10-06")).toBe(2029)
    expect(defaultSeatsYear([], "2026-10-06")).toBeNull()
  })
})

describe("the Seats nav entry", () => {
  it("shows Seats to staff who manage academic years, and to no one else", () => {
    const seats = STAFF_NAV.find((entry) => entry.label === "Seats")
    expect(seats).toEqual({ href: "/staff/seats", label: "Seats", permission: "academic_years.manage" })
    expect(navFor(["academic_years.manage"])).toContain(seats)
    expect(navFor(["payments.view", "payments.record", "leads.view"])).not.toContain(seats)
  })
})
