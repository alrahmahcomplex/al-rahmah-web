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

type User = ReturnType<typeof userEvent.setup>

async function toStudentStep(user: User, props: { canEditContact: boolean; canEnterReferralCode: boolean; interviewDiscount: number | null }) {
  render(<NewStudentForm today="2026-10-06" years={[2026, 2027]} {...props} />)
  await user.type(screen.getByLabelText("Full name"), "Mwanaidi Said")
  await user.type(screen.getByLabelText("Phone"), "0700 000 999")
  await user.click(screen.getByRole("button", { name: "Continue" }))
  await screen.findByLabelText("Student's full name")
}

async function fillStudent(user: User) {
  await user.type(screen.getByLabelText("Student's full name"), "Hamisi Said")
  await user.click(screen.getByRole("radio", { name: "STD 3" }))
  await user.click(screen.getByRole("radio", { name: "2027" }))
  await user.click(screen.getByRole("radio", { name: "Day" }))
}

async function registerWithCode(user: User, interviewDiscount: number | null = 10000) {
  await toStudentStep(user, { canEditContact: true, canEnterReferralCode: true, interviewDiscount })
  await fillStudent(user)
  await user.type(screen.getByLabelText(/^Referral code/), "bjn-402")
  await screen.findByText(/Baraka Juma Njoroge/)
  await user.click(screen.getByRole("button", { name: "Continue to review" }))
  await user.click(await screen.findByRole("button", { name: "Register student" }))
}

beforeEach(() => {
  stubs.lookUp.mockReset().mockResolvedValue({ status: "found", agent: AGENT })
  stubs.register.mockReset()
})

describe("New Student with a Referral code", () => {
  it("names the agent and the interview fee the family will pay, from the discount it was given", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: true, interviewDiscount: 10000 })
    await user.type(screen.getByLabelText(/^Referral code/), "bjn-402")
    expect(await screen.findByText("Baraka Juma Njoroge · interview fee becomes TZS 40,000")).toBeInTheDocument()
  })

  it("names only the agent when the discount could not be read", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: true, interviewDiscount: null })
    await user.type(screen.getByLabelText(/^Referral code/), "bjn-402")
    expect(await screen.findByText("Baraka Juma Njoroge · Approved")).toBeInTheDocument()
    expect(screen.getByRole("status")).not.toHaveTextContent("TZS")
  })

  it("sends the agent's code with the registration", async () => {
    stubs.register.mockResolvedValue({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "saved" })
    await registerWithCode(userEvent.setup())

    expect(stubs.register).toHaveBeenCalledWith(
      expect.objectContaining({
        referralCode: "BJN-402",
        student: { fullName: "Hamisi Said", className: "STD 3", enrollmentYear: 2027, dayOrBoarding: "Day" },
        visitDate: "2026-10-06",
      }),
    )
    expect(await screen.findByLabelText("Admission Number")).toHaveTextContent("ADMSN-12345")
    expect(screen.getByRole("link", { name: "Open Hamisi Said" })).toHaveAttribute("href", `/staff/leads/${LEAD}`)
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
    await toStudentStep(user, { canEditContact: false, canEnterReferralCode: false, interviewDiscount: 10000 })
    expect(screen.queryByLabelText(/^Referral code/)).not.toBeInTheDocument()
  })
})

describe("the registration screens", () => {
  it("asks one question per screen, keeps the entered steps in the rail, and Change returns to a step", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false, interviewDiscount: null })

    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Who is the student?")
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus()
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument()
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "2")

    const rail = screen.getByRole("list", { name: "Steps" })
    expect(rail).toHaveTextContent("Mwanaidi Said · Mother")
    expect(rail).toHaveTextContent("0700 000 999")

    await user.click(screen.getByRole("button", { name: "Change parent or guardian" }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Who is the parent or guardian?")
    expect(screen.getByLabelText("Full name")).toHaveValue("Mwanaidi Said")
    expect(screen.getByRole("radio", { name: "Mother" })).toBeChecked()
  })

  it("will not go to Review until a class, a year and day or boarding are chosen", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false, interviewDiscount: null })
    await user.type(screen.getByLabelText("Student's full name"), "Hamisi Said")

    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Who is the student?")
    expect(screen.getByRole("radiogroup", { name: "Class they are joining" })).toHaveAccessibleDescription("Choose the student's class.")
    expect(screen.getByRole("radio", { name: "DAY CARE" })).toHaveFocus()

    await user.click(screen.getByRole("radio", { name: "FORM 1" }))
    expect(screen.getByRole("radiogroup", { name: "Class they are joining" })).toHaveAccessibleDescription(
      "For FORM 1 you can add the Pre-Form One programme after registration.",
    )
    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(screen.getByRole("radiogroup", { name: "Enrollment year" })).toHaveAccessibleDescription("Choose the year the student will enroll.")

    await user.click(screen.getByRole("radio", { name: "2026" }))
    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(screen.getByRole("radiogroup", { name: "Day or boarding" })).toHaveAccessibleDescription("Choose day or boarding.")

    await user.click(screen.getByRole("radio", { name: "Boarding" }))
    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Check and register")
    expect(screen.getByRole("region", { name: "Student" })).toHaveTextContent("FORM 1")
    expect(screen.getByRole("region", { name: "Student" })).toHaveTextContent("Boarding")
  })

  it("keeps the visit date as a line until it is changed", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false, interviewDiscount: null })

    expect(screen.queryByLabelText("Visit date")).not.toBeInTheDocument()
    expect(screen.getByText(/^Visit date: today, 6 Oct 2026/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Change visit date" }))
    const date = screen.getByLabelText("Visit date")
    expect(date).toHaveValue("2026-10-06")
    expect(date).toHaveAttribute("max", "2026-10-06")
    expect(date).toHaveFocus()
  })

  it("Register another child keeps the parent and starts the Family check again", async () => {
    stubs.register.mockResolvedValue({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "none" })
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false, interviewDiscount: null })
    await fillStudent(user)
    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    await user.click(await screen.findByRole("button", { name: "Register student" }))
    expect(await screen.findByRole("heading", { level: 1 })).toHaveTextContent("Hamisi Said is registered")

    await user.click(screen.getByRole("button", { name: "Register another child" }))
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Who is the parent or guardian?")
    expect(screen.getByLabelText("Full name")).toHaveValue("Mwanaidi Said")
    await user.click(screen.getByRole("button", { name: "Continue" }))
    expect(await screen.findByLabelText("Student's full name")).toHaveValue("")
    expect(screen.getByRole("radio", { name: "STD 3" })).not.toBeChecked()
  })
})
