import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/app/staff/check-in/new/actions", () => ({ findCustodianFamily: vi.fn() }))
vi.mock("@/app/staff/check-in/new/code-actions", () => ({ listCodesToPick: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/referral-actions", () => ({ lookUpReferralCode: vi.fn() }))

import { NameQuestion } from "@/app/staff/check-in/new/questions"

// The student's name question keeps the last-name choice it was given (#511):
// check-in prefills a name ending with the father's middle name, and saving
// the question unchanged must not rename the student.

const PREFILL = { firstName: "YUSUF", fatherFirst: "ALI", fatherMiddle: "OMARI", fatherLast: "HASSAN", lastNameFrom: "father_middle" as const }

describe("NameQuestion", () => {
  it("shows and saves the name the choice builds when reopened and sent unchanged", async () => {
    const onDone = vi.fn()
    render(<NameQuestion id="n" next={false} saved={PREFILL} onDone={onDone} />)
    expect(screen.getByText("YUSUF ALI OMARI")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith(PREFILL)
  })

  it("keeps the choice when a box is corrected", async () => {
    const onDone = vi.fn()
    render(<NameQuestion id="n" next={false} saved={PREFILL} onDone={onDone} />)
    const first = screen.getByRole("textbox", { name: "Student’s name" })
    await userEvent.clear(first)
    await userEvent.type(first, "yusufu")
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ ...PREFILL, firstName: "YUSUFU" })
  })

  it("starts with the father's last name for a new student", async () => {
    const onDone = vi.fn()
    render(<NameQuestion id="n" next={false} saved={{ ...PREFILL, lastNameFrom: undefined }} onDone={onDone} />)
    expect(screen.getByText("YUSUF ALI HASSAN")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("button", { name: /Continue/ }))
    expect(onDone).toHaveBeenCalledWith({ ...PREFILL, lastNameFrom: "father_last" })
  })
})
