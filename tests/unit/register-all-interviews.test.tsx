import { act, fireEvent, render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

const actions = vi.hoisted(() => ({ registerInterviewFromFinish: vi.fn() }))
vi.mock("@/app/staff/check-in/new/interview-actions", () => actions)

import { InterviewSheet, useInterviewRegistration, type InterviewStudent } from "@/app/staff/check-in/new/interview-sheet"

// Register all for interview on the finished screen (#511, the owner's own
// feature): it skips a student already registered, registers the others one
// by one, and a refusal in the middle leaves the rest registered and says
// which student it was about.

const STUDENTS: InterviewStudent[] = [
  { leadId: "a", admissionNumber: "ADMSN-1", name: "AMINA JUMA SAID", className: "STD 1" },
  { leadId: "b", admissionNumber: "ADMSN-2", name: "BARAKA JUMA SAID", className: "STD 3" },
  { leadId: "c", admissionNumber: "ADMSN-3", name: "CHAUSIKU JUMA SAID", className: "STD 5" },
  { leadId: "d", admissionNumber: "ADMSN-4", name: "DAUDI JUMA SAID", className: "FORM 1" },
]

function Finished({ students }: { students: InterviewStudent[] }) {
  const reg = useInterviewRegistration(students)
  return (
    <>
      <button type="button" onClick={reg.openSheet}>
        Open
      </button>
      <InterviewSheet reg={reg} students={students} />
    </>
  )
}

const sheet = () => screen.getByRole("dialog", { name: "Register for interview" })
const row = (name: string) => within(sheet()).getByText(name).closest(".rs-iv-row") as HTMLElement
const click = (el: HTMLElement) =>
  act(async () => {
    fireEvent.click(el)
  })

beforeEach(() => {
  actions.registerInterviewFromFinish.mockReset().mockImplementation(async (leadId: string) =>
    leadId === "c" ? { status: "refused", message: "This application is closed, so the applicant can't be registered for interview." } : { status: "registered", message: "Registered." },
  )
})

describe("Register all for interview", () => {
  it("skips the student already registered, registers the rest, and a refusal in the middle stops none of them", async () => {
    render(<Finished students={STUDENTS} />)
    await click(screen.getByRole("button", { name: "Open" }))

    // Amina first, on her own button.
    await click(within(row("AMINA JUMA SAID")).getByRole("button", { name: "Register for interview" }))
    expect(within(row("AMINA JUMA SAID")).getByText("Registered for interview")).toBeInTheDocument()
    expect(actions.registerInterviewFromFinish).toHaveBeenCalledTimes(1)

    await click(within(sheet()).getByRole("button", { name: "Register all for interview" }))

    // Amina is not sent again; the other three are, in form order.
    expect(actions.registerInterviewFromFinish.mock.calls.map(([id]) => id)).toEqual(["a", "b", "c", "d"])
    for (const name of ["AMINA JUMA SAID", "BARAKA JUMA SAID", "DAUDI JUMA SAID"]) {
      expect(within(row(name)).getByText("Registered for interview")).toBeInTheDocument()
    }
    // Chausiku's refusal: her button stays, and the error names her.
    expect(within(row("CHAUSIKU JUMA SAID")).getByRole("button", { name: "Register for interview" })).toBeInTheDocument()
    expect(within(sheet()).getByRole("alert")).toHaveTextContent("CHAUSIKU JUMA SAID: This application is closed, so the applicant can't be registered for interview.")
    // One still to register: Register all stays for her.
    expect(within(sheet()).getByRole("button", { name: "Register all for interview" })).toBeInTheDocument()
  })

  it("a student someone else already put on the list shows as registered and is not tried again", async () => {
    actions.registerInterviewFromFinish.mockImplementation(async (leadId: string) => (leadId === "b" ? { status: "already" } : { status: "registered", message: "Registered." }))
    render(<Finished students={STUDENTS.slice(0, 2)} />)
    await click(screen.getByRole("button", { name: "Open" }))
    await click(within(sheet()).getByRole("button", { name: "Register all for interview" }))

    for (const name of ["AMINA JUMA SAID", "BARAKA JUMA SAID"]) {
      expect(within(row(name)).getByText("Registered for interview")).toBeInTheDocument()
    }
    expect(within(sheet()).queryByRole("alert")).toBeNull()
    expect(within(sheet()).queryByRole("button", { name: "Register all for interview" })).toBeNull()
    expect(within(sheet()).getByRole("button", { name: "Done" })).toBeInTheDocument()
    expect(actions.registerInterviewFromFinish).toHaveBeenCalledTimes(2)
  })
})
