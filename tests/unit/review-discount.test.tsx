import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ decide: vi.fn(), toast: vi.fn() }))
vi.mock("@/app/staff/applicants/[id]/discount-actions", () => ({ decideDiscountAction: mocks.decide }))
vi.mock("@/components/kit/toast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/kit/toast")>()),
  toast: mocks.toast,
}))

import { ReviewDiscount } from "@/app/staff/discounts/review-discount"

// Review on a Discount requests row (#327), with the decision stubbed: the
// sheet sends the lead record's decision, asks for a reason before a refusal,
// and says what happened in a toast.

const REQUEST = {
  leadId: "lead-1",
  requestId: "request-1",
  studentName: "Neema Review Test",
  admissionNumber: "DMSN-90001",
  leadHref: "/staff/applicants/lead-1?tab=discounts#lead-discounts",
  discount: "Staff child (25% off)",
  place: "STD 2 Day, 2027",
  note: "Mother teaches Year 3.",
  requestedByOn: "Example Staff One on 12 Nov 2026",
  canGrant: true,
}

beforeEach(() => {
  mocks.decide.mockReset()
  mocks.toast.mockReset()
})

async function openReview(props: Partial<typeof REQUEST> = {}) {
  const user = userEvent.setup()
  render(<ReviewDiscount {...REQUEST} {...props} />)
  await user.click(screen.getByRole("button", { name: "Review" }))
  return { user, sheet: await screen.findByRole("dialog") }
}

describe("the discount review sheet", () => {
  it("shows the request and links to the lead's Discounts tab", async () => {
    const { sheet } = await openReview()
    expect(sheet).toHaveAccessibleName("Staff child (25% off)")
    expect(sheet).toHaveTextContent("Mother teaches Year 3.")
    expect(sheet).toHaveTextContent("Example Staff One on 12 Nov 2026")
    expect(screen.getByRole("link", { name: "DMSN-90001" })).toHaveAttribute("href", REQUEST.leadHref)
  })

  it("grants, closes and says so", async () => {
    mocks.decide.mockResolvedValue({ status: "done" })
    const { user } = await openReview()
    await user.click(screen.getByRole("button", { name: "Grant the discount" }))
    expect(mocks.decide).toHaveBeenCalledWith("lead-1", "request-1", "grant", null)
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(mocks.toast).toHaveBeenCalledWith("Granted for Neema Review Test. The desk can see it now.", { tone: "good" })
  })

  it("keeps the sheet open with the reason when the grant is refused", async () => {
    mocks.decide.mockResolvedValue({ status: "refused", message: "This request was already decided." })
    const { user, sheet } = await openReview()
    await user.click(screen.getByRole("button", { name: "Grant the discount" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("This request was already decided.")
    expect(sheet).toBeInTheDocument()
    expect(mocks.toast).not.toHaveBeenCalled()
  })

  it("asks for a reason before refusing, then refuses with it", async () => {
    mocks.decide.mockResolvedValue({ status: "done" })
    const { user } = await openReview()
    await user.click(screen.getByRole("button", { name: "Refuse request" }))
    await user.click(screen.getByRole("button", { name: "Refuse request" }))
    expect(await screen.findByRole("alert")).toHaveTextContent("Write why the discount is refused.")
    expect(mocks.decide).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText("Why is it refused?"), "The bus is run by a contractor.")
    await user.click(screen.getByRole("button", { name: "Refuse request" }))
    expect(mocks.decide).toHaveBeenCalledWith("lead-1", "request-1", "refuse", "The bus is run by a contractor.")
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())
    expect(mocks.toast).toHaveBeenCalledWith("Refused for Neema Review Test. The desk can see it now.")
  })

  it("goes back from the reason to the request without refusing", async () => {
    const { user } = await openReview()
    await user.click(screen.getByRole("button", { name: "Refuse request" }))
    await user.click(screen.getByRole("button", { name: "Back" }))
    expect(screen.getByRole("button", { name: "Grant the discount" })).toBeVisible()
    expect(screen.queryByLabelText("Why is it refused?")).toBeNull()
    expect(mocks.decide).not.toHaveBeenCalled()
  })

  it("only refuses on a closed application", async () => {
    const { sheet } = await openReview({ canGrant: false })
    expect(screen.queryByRole("button", { name: "Grant the discount" })).toBeNull()
    expect(sheet).toHaveTextContent("This application is closed. It can be granted only after it is reopened.")
    expect(screen.getByRole("button", { name: "Refuse request" })).toBeVisible()
  })
})
