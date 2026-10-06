import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

// New Student's screens with the Referral code (#81), the Server Actions
// stubbed: what staff see when the code reaches the lead, and when it doesn't.

const stubs = vi.hoisted(() => ({ register: vi.fn(), lookUp: vi.fn() }))

vi.mock("@/app/staff/check-in/actions", () => ({
  findFamily: async () => ({ status: "found", match: { phone: "+255700000999", whatsapp: null, contacts: [] } }),
  registerWalkIn: (...args: unknown[]) => stubs.register(...args),
  updateSharedContact: vi.fn(),
}))
vi.mock("@/app/staff/leads/[id]/referral-actions", () => ({
  lookUpReferralCode: (...args: unknown[]) => stubs.lookUp(...args),
  saveLeadReferralCode: vi.fn(),
}))

import { NewStudentForm } from "@/app/staff/check-in/new/new-student-form"

const LEAD = "1ead0000-0000-4000-8000-000000000999"
const AGENT = { code: "BJN-402", fullName: "Baraka Juma Njoroge", state: "approved" }

async function registerWithCode(user: ReturnType<typeof userEvent.setup>) {
  render(<NewStudentForm today="2026-10-06" years={[2026, 2027]} canEditContact canEnterReferralCode />)
  await user.type(screen.getByLabelText("Full name"), "Mwanaidi Said")
  await user.type(screen.getByLabelText("Phone"), "0700 000 999")
  await user.click(screen.getByRole("button", { name: "Continue" }))

  await user.type(await screen.findByLabelText("Student's full name"), "Hamisi Said")
  await user.selectOptions(screen.getByLabelText("Class"), "STD 3")
  await user.selectOptions(screen.getByLabelText("Enrollment year"), "2027")
  await user.click(screen.getByLabelText("Day"))
  await user.type(screen.getByLabelText("Referral code (optional)"), "bjn-402")
  await screen.findByText("Baraka Juma Njoroge · Approved")
  await user.click(screen.getByRole("button", { name: "Review" }))
  await user.click(await screen.findByRole("button", { name: "Register student" }))
}

beforeEach(() => {
  stubs.lookUp.mockReset().mockResolvedValue({ status: "found", agent: AGENT })
  stubs.register.mockReset()
})

describe("New Student with a Referral code", () => {
  it("sends the agent's code with the registration", async () => {
    stubs.register.mockResolvedValue({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "saved" })
    await registerWithCode(userEvent.setup())

    expect(stubs.register).toHaveBeenCalledWith(expect.objectContaining({ referralCode: "BJN-402" }))
    expect(await screen.findByLabelText("Admission Number")).toHaveTextContent("ADMSN-12345")
    expect(screen.queryByText(/referral code wasn't saved/)).not.toBeInTheDocument()
  })

  it("shows the Admission Number, then says the code wasn't saved and links to the lead's Referral code panel", async () => {
    stubs.register.mockResolvedValue({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "not-saved" })
    await registerWithCode(userEvent.setup())

    expect(await screen.findByLabelText("Admission Number")).toHaveTextContent("ADMSN-12345")
    expect(screen.getByRole("alert")).toHaveTextContent("The lead was created, but the referral code wasn't saved.")
    expect(screen.getByRole("link", { name: "Add the referral code" })).toHaveAttribute(
      "href",
      `/staff/leads/${LEAD}#lead-referral`,
    )
  })

  it("has no Referral code field for staff who may not set one", async () => {
    const user = userEvent.setup()
    render(<NewStudentForm today="2026-10-06" years={[2026, 2027]} canEditContact={false} canEnterReferralCode={false} />)
    await user.type(screen.getByLabelText("Full name"), "Mwanaidi Said")
    await user.type(screen.getByLabelText("Phone"), "0700 000 999")
    await user.click(screen.getByRole("button", { name: "Continue" }))

    await screen.findByLabelText("Student's full name")
    expect(screen.queryByLabelText("Referral code (optional)")).not.toBeInTheDocument()
  })
})
