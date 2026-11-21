import { describe, expect, it } from "vitest"

import { navFor, STAFF_NAV } from "@/app/staff/navigation"
import { defaultSeatsYear } from "@/app/staff/seats/format"

describe("defaultSeatsYear", () => {
  it("opens the latest year with a schedule up to the current admission year", () => {
    expect(defaultSeatsYear([2026, 2027, 2028], "2026-05-31")).toBe(2026)
    expect(defaultSeatsYear([2026, 2027, 2028], "2026-06-01")).toBe(2027)
    expect(defaultSeatsYear([2026, 2027, 2028], "2026-10-06")).toBe(2027)
    expect(defaultSeatsYear([2025, 2027], "2026-10-06")).toBe(2027)
    expect(defaultSeatsYear([2024, 2025], "2026-10-06")).toBe(2025)
    // Only later years: the earliest of them.
    expect(defaultSeatsYear([2030, 2029], "2026-10-06")).toBe(2029)
    expect(defaultSeatsYear([], "2026-10-06")).toBeNull()
  })
})

describe("the Seats nav entry", () => {
  it("shows Seats to everyone who may view payments, and to no one else (#449)", () => {
    const seats = STAFF_NAV.find((entry) => entry.label === "Seats")
    expect(seats).toMatchObject({ href: "/staff/seats", group: "Money", permission: "payments.view" })
    expect(seats?.alsoNeeds).toBeUndefined()
    expect(navFor(["academic_years.manage", "payments.view"])).toContain(seats)
    // Seats are counted in streams: staff who can't manage academic years
    // open the screen too, and ask for a stream there.
    expect(navFor(["payments.view", "payments.record", "leads.view"])).toContain(seats)
    expect(navFor(["payments.view"])).toContain(seats)
    // The streams sit behind payments.view, so the page would refuse.
    expect(navFor(["academic_years.manage"])).not.toContain(seats)
    expect(navFor(["leads.view", "payments.record"])).not.toContain(seats)
  })
})
