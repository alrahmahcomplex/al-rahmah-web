import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/staff/reports" }))
vi.mock("@/app/staff/seats/stream-actions", () => ({ openStreamAction: vi.fn(), editStreamAction: vi.fn(), bringUpAction: vi.fn(), requestStreamAction: vi.fn() }))

import { SeatsByClassPanel } from "@/app/staff/reports/_dashboard/seats-by-class"
import type { ClassStreamFigures, SeatsByClass } from "@/lib/services/dashboard"

// Reports' Seats by class once streams are on (#449, v42, the owner's Q10):
// one row per stream under its class, a class total with how many wait, and a
// class with no streams as its total alone (lead, 2026-11-19).

const FORM1: ClassStreamFigures = {
  className: "FORM 1",
  streams: [
    { id: "a", label: "A", takes: "Girls", seats: 20, full: 3, firstInstalment: 5, deposit: 4, free: 8 },
    { id: "b", label: "B", takes: "Boys", seats: 20, full: 6, firstInstalment: 10, deposit: 4, free: 0 },
  ],
  full: 9,
  firstInstalment: 15,
  deposit: 9,
  waiting: 1,
}
const DAYCARE: ClassStreamFigures = { className: "DAY CARE", streams: [], full: 1, firstInstalment: 0, deposit: 2, waiting: 0 }

const named = (figures: ClassStreamFigures[]): SeatsByClass => ({
  year: 2027,
  years: [2027],
  classes: [],
  named: { streams: { mode: "named", year: 2027, classes: [], requests: [] }, figures },
})

const cells = (name: string) =>
  within(screen.getByRole("row", { name: new RegExp(`^${name}`) }))
    .getAllByRole("cell")
    .map((cell) => cell.textContent)

describe("SeatsByClassPanel once streams are on", () => {
  it("shows a row per stream, the class total with who waits, and a class with no streams as its total", () => {
    render(<SeatsByClassPanel seats={{ ok: true, data: named([DAYCARE, FORM1]) }} canOpenSeats={false} />)
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Stream", "Takes", "Seats", "Full", "First instalment", "Deposit", "Free"])
    expect(cells("FORM 1 A")).toEqual(["FORM 1 A", "Girls", "20", "3", "5", "4", "8"])
    expect(cells("FORM 1 B")).toEqual(["FORM 1 B", "Boys", "20", "6", "10", "4", "0"])
    expect(cells("FORM 1 total")).toEqual(["FORM 1 total", "1 waiting", "40", "9", "15", "8", "8"])
    expect(cells("DAY CARE total")).toEqual(["DAY CARE total", "", "Seats not set", "1", "0", "2", "–Seats not set"])
    expect(screen.queryByRole("row", { name: /^DAY CARE$/ })).not.toBeInTheDocument()
  })
})
