import { render, screen, within } from "@testing-library/react"
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
vi.mock("@/app/staff/applicants/[id]/referral-actions", () => ({
  lookUpReferralCode: (...args: unknown[]) => stubs.lookUp(...args),
  saveLeadReferralCode: vi.fn(),
}))

import { NewStudentForm } from "@/app/staff/check-in/new/new-student-form"

const LEAD = "1ead0000-0000-4000-8000-000000000999"
const AGENT = {
  kind: "agent",
  code: "BJN-402",
  holderName: "Baraka Juma Njoroge",
  state: "approved",
  amountOff: 10000,
  agentId: "a9e00000-0000-4000-8000-000000000402",
  promoCodeId: null,
}
const PROMO = {
  kind: "promo",
  code: "INSTA26",
  holderName: "Instagram ad, November 2026",
  state: "active",
  amountOff: 25000,
  agentId: null,
  promoCodeId: "9a000000-0000-4000-8000-000000000026",
}

type User = ReturnType<typeof userEvent.setup>

async function toStudentStep(user: User, props: { canEditContact: boolean; canEnterReferralCode: boolean }) {
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

async function registerWithCode(user: User) {
  await toStudentStep(user, { canEditContact: true, canEnterReferralCode: true })
  await fillStudent(user)
  await user.type(screen.getByLabelText(/^Referral code/), "bjn-402")
  await screen.findByText(/Baraka Juma Njoroge/)
  await user.click(screen.getByRole("button", { name: "Continue to review" }))
  await user.click(await screen.findByRole("button", { name: "Register student" }))
}

beforeEach(() => {
  stubs.lookUp.mockReset().mockResolvedValue({ status: "found", code: AGENT })
  stubs.register.mockReset()
})

describe("New Student with a Referral code", () => {
  it("names the agent and the interview fee the family will pay, from the code's own amount", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: true })
    await user.type(screen.getByLabelText(/^Referral code/), "bjn-402")
    expect(await screen.findByText("Baraka Juma Njoroge · interview fee becomes TZS 40,000")).toBeInTheDocument()
  })

  it("names a Promo code, its fee and that no agent or commission comes with it", async () => {
    stubs.lookUp.mockResolvedValue({ status: "found", code: PROMO })
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: true })
    await user.type(screen.getByLabelText(/^Referral code/), "insta26")
    expect(
      await screen.findByText(
        "Instagram ad, November 2026 · Promo code · interview fee becomes TZS 25,000. No Marketing Agent. No commission.",
      ),
    ).toBeInTheDocument()
  })

  it("names a paused Promo code without a fee change", async () => {
    stubs.lookUp.mockResolvedValue({ status: "found", code: { ...PROMO, state: "paused", amountOff: 0 } })
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: true })
    await user.type(screen.getByLabelText(/^Referral code/), "insta26")
    expect(
      await screen.findByText("Instagram ad, November 2026 · Promo code, Paused · no discount. No Marketing Agent. No commission."),
    ).toBeInTheDocument()
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
    expect(screen.getByRole("link", { name: "Open Hamisi Said" })).toHaveAttribute("href", `/staff/applicants/${LEAD}`)
    expect(screen.queryByText(/referral code wasn't saved/)).not.toBeInTheDocument()
  })

  it("shows the Admission Number, then says the code wasn't saved and links to the lead's Referral code panel", async () => {
    stubs.register.mockResolvedValue({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "not-saved" })
    await registerWithCode(userEvent.setup())

    expect(await screen.findByLabelText("Admission Number")).toHaveTextContent("ADMSN-12345")
    expect(screen.getByRole("alert")).toHaveTextContent("The application was created, but the referral code wasn't saved.")
    expect(screen.getByRole("link", { name: "Add the referral code" })).toHaveAttribute(
      "href",
      `/staff/applicants/${LEAD}#lead-referral`,
    )
  })

  it("has no Referral code field for staff who may not set one", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: false, canEnterReferralCode: false })
    expect(screen.queryByLabelText(/^Referral code/)).not.toBeInTheDocument()
  })
})

describe("the registration screens", () => {
  it("asks one question per screen, keeps the entered steps in the rail, and Change returns to a step", async () => {
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false })

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
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false })
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
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false })

    expect(screen.queryByLabelText("Visit date")).not.toBeInTheDocument()
    expect(screen.getByText(/^Visit date: today, 6 Oct 2026/)).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Change visit date" }))
    const date = screen.getByLabelText("Visit date")
    expect(date).toHaveValue("2026-10-06")
    expect(date).toHaveAttribute("max", "2026-10-06")
    expect(date).toHaveFocus()
  })

  it("holds the rail's Change links while the registration runs", async () => {
    let finish: (outcome: unknown) => void = () => {}
    stubs.register.mockReturnValue(new Promise((resolve) => (finish = resolve)))
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false })
    await fillStudent(user)
    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    await user.click(await screen.findByRole("button", { name: "Register student" }))

    const rail = within(screen.getByRole("list", { name: "Steps" }))
    expect(rail.getByRole("button", { name: "Change student" })).toBeDisabled()
    expect(rail.getByRole("button", { name: "Change parent or guardian" })).toBeDisabled()
    expect(within(screen.getByRole("region", { name: "Student" })).getByRole("button", { name: "Change student" })).toBeDisabled()
    finish({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "none" })
    expect(await screen.findByLabelText("Admission Number")).toHaveTextContent("ADMSN-12345")
  })

  it("retires the duplicate refusal once the rail's Change leaves Review", async () => {
    stubs.register.mockResolvedValue({ status: "duplicate", admissionNumber: "ADMSN-55555", href: "/staff/applicants/x" })
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false })
    await fillStudent(user)
    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    await user.click(await screen.findByRole("button", { name: "Register student" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Already registered")

    await user.click(within(screen.getByRole("list", { name: "Steps" })).getByRole("button", { name: "Change student" }))
    await user.type(screen.getByLabelText("Student's full name"), " Junior")
    await user.click(screen.getByRole("button", { name: "Continue to review" }))
    expect(await screen.findByRole("button", { name: "Register student" })).toBeInTheDocument()
    expect(screen.queryByRole("alert")).not.toBeInTheDocument()
  })

  it("Register another child keeps the parent and starts the Family check again", async () => {
    stubs.register.mockResolvedValue({ status: "created", leadId: LEAD, admissionNumber: "ADMSN-12345", referralCode: "none" })
    const user = userEvent.setup()
    await toStudentStep(user, { canEditContact: true, canEnterReferralCode: false })
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
