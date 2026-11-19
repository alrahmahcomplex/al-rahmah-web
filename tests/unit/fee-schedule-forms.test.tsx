import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ saveSchedule: vi.fn(), saveAcademicYear: vi.fn() }))
vi.mock("@/app/staff/fees/actions", () => actions)
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))

import { AcademicYearEditor } from "@/app/staff/fees/academic-year-editor"
import { ScheduleEditor } from "@/app/staff/fees/schedule-editor"
import { BAND_NAMES, FEE_BANDS, type FeeAmounts } from "@/lib/services/fees"

// The Fee schedule's two edit forms, with the server actions stubbed: each
// field saves under its own key. One value changes, the form is saved, and
// only that amount, share or date differs from what the form opened with
// (#329: the redesign rewired every field).

const YEAR = 2027

const AMOUNTS: FeeAmounts = {
  bands: {
    nursery: { day: 1_100_001, boarding: 3_000_002 },
    primary_lower: { day: 2_000_003, boarding: 3_000_004 },
    primary_upper: { day: 2_100_005, boarding: 3_300_006 },
    secondary: { day: 2_800_007, boarding: 4_300_008 },
  },
  split: { first: 40, second: 40, third: 20 },
  dueDates: { first: "2026-11-01", second: "2027-04-01", third: "2027-06-01" },
  minimumDeposit: 300_009,
  preFormOne: { day: 450_010, boarding: 580_011 },
}

// A field by its accessible label: the label's screen-reader text where the
// visible one is shorter, its whole text otherwise.
function field(name: string): HTMLInputElement {
  const label = [...document.querySelectorAll("label")].find(
    (each) => (each.querySelector(".sr-only")?.textContent ?? each.textContent) === name,
  )
  if (!label) throw new Error(`No field labelled "${name}"`)
  const input = document.getElementById(label.htmlFor)
  if (!(input instanceof HTMLInputElement)) throw new Error(`"${name}" labels no input`)
  return input
}

type AmountCase = { label: string; value: string; expect: (amounts: FeeAmounts) => void }

const amountCases: AmountCase[] = [
  ...FEE_BANDS.flatMap((band) => [
    { label: `${BAND_NAMES[band]} Day fee`, value: "1,234,567", expect: (a: FeeAmounts) => (a.bands[band].day = 1_234_567) },
    { label: `${BAND_NAMES[band]} Boarding fee`, value: "7654321", expect: (a: FeeAmounts) => (a.bands[band].boarding = 7_654_321) },
  ]),
  ...(["first", "second", "third"] as const).flatMap((key, i) => {
    const label = ["First", "Second", "Third"][i]
    return [
      { label: `${label} instalment share (%)`, value: "33", expect: (a: FeeAmounts) => (a.split[key] = 33) },
      { label: `${label} instalment due date`, value: "0" + (i + 2) + "/02/2027", expect: (a: FeeAmounts) => (a.dueDates[key] = "2027-02-0" + (i + 2)) },
    ]
  }),
  { label: "Minimum Initial deposit", value: "123,456", expect: (a) => (a.minimumDeposit = 123_456) },
  { label: "Pre-Form One programme Day fee", value: "111111", expect: (a) => (a.preFormOne.day = 111_111) },
  { label: "Pre-Form One programme Boarding fee", value: "222222", expect: (a) => (a.preFormOne.boarding = 222_222) },
]

describe("the Fee schedule form", () => {
  beforeEach(() => {
    actions.saveSchedule.mockReset()
    actions.saveSchedule.mockResolvedValue({ status: "saved" })
  })

  it("has the 17 fields the cases cover", () => {
    render(<ScheduleEditor year={YEAR} amounts={null} />)
    const form = screen.getByRole("form", { name: `Fee schedule ${YEAR}` })
    expect(form.querySelectorAll("input")).toHaveLength(amountCases.length)
  })

  it.each(amountCases)("saves $label under its own key", async ({ label, value, expect: change }) => {
    render(<ScheduleEditor year={YEAR} amounts={AMOUNTS} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit amounts" }))
    fireEvent.change(field(label), { target: { value } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    const expected = structuredClone(AMOUNTS)
    change(expected)
    await waitFor(() => expect(actions.saveSchedule).toHaveBeenCalledTimes(1))
    expect(actions.saveSchedule).toHaveBeenCalledWith(YEAR, expected)
    expect(await screen.findByRole("status")).toHaveTextContent("Fee amounts saved.")
  })

  it("does not save while a due date cannot be read", async () => {
    render(<ScheduleEditor year={YEAR} amounts={AMOUNTS} />)
    fireEvent.click(screen.getByRole("button", { name: "Edit amounts" }))
    const due = field("Second instalment due date")
    fireEvent.change(due, { target: { value: "31/02/20x7" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))

    await waitFor(() => expect(due).toHaveFocus())
    expect(due).toHaveAttribute("aria-invalid", "true")
    expect(actions.saveSchedule).not.toHaveBeenCalled()
    expect(screen.getByRole("form", { name: `Fee schedule ${YEAR}` })).toBeInTheDocument()
  })
})

const START = "2027-01-11"

describe("the Academic year form", () => {
  beforeEach(() => {
    actions.saveAcademicYear.mockReset()
    actions.saveAcademicYear.mockResolvedValue({ status: "saved" })
  })

  it("has the start alone, and saves it against the start it opened with, never seats (#449)", async () => {
    render(
      <AcademicYearEditor year={YEAR} start={START}>
        <p>View</p>
      </AcademicYearEditor>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit start" }))
    const form = screen.getByRole("form", { name: `Academic year ${YEAR}` })
    expect(form.querySelectorAll("input")).toHaveLength(1)
    expect(screen.queryByText("Seats in each class")).not.toBeInTheDocument()
    fireEvent.change(field("Academic-year start"), { target: { value: "20/01/2027" } })
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(actions.saveAcademicYear).toHaveBeenCalledTimes(1))
    expect(actions.saveAcademicYear).toHaveBeenCalledWith(YEAR, { start: "2027-01-20" }, { start: START })
    expect(await screen.findByRole("status")).toHaveTextContent("Start saved.")
  })

  it("sends no start when none was set and none is typed", async () => {
    render(
      <AcademicYearEditor year={YEAR} start={null}>
        <p>View</p>
      </AcademicYearEditor>,
    )
    fireEvent.click(screen.getByRole("button", { name: "Edit start" }))
    fireEvent.click(screen.getByRole("button", { name: "Save" }))
    await waitFor(() => expect(actions.saveAcademicYear).toHaveBeenCalledWith(YEAR, { start: null }, { start: null }))
  })
})
