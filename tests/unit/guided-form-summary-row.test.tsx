import { render, screen, within } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { ChangeLink, SummaryRow } from "@/components/guided-form"

// The folded answer line, one group per question (owner, #503 slice 4d-c):
// the question's label on the left, the answer on the right with its change
// link right under it. Shared by the Discount code form, /apply and staff check-in.

describe("SummaryRow", () => {
  it("puts the label on the left and the answer with its change link together on the right", () => {
    const { container } = render(<SummaryRow label="Jina lako kamili" value="REHEMA ALI JUMA" action={<ChangeLink onClick={() => {}}>Badilisha Jina</ChangeLink>} />)
    const label = container.querySelector("[data-summary-label]")
    const answer = container.querySelector<HTMLElement>("[data-summary-answer]")!
    expect(label).toHaveTextContent("Jina lako kamili")
    // The answer and its link are one block, right-aligned, apart from the label.
    expect(answer).toHaveClass("items-end", "text-right")
    expect(within(answer).getByText("REHEMA ALI JUMA")).toBeInTheDocument()
    expect(within(answer).getByRole("button", { name: "Badilisha Jina" })).toBeInTheDocument()
    expect(label?.contains(screen.getByText("REHEMA ALI JUMA"))).toBe(false)
    // The link comes after the answer it changes.
    const [value, link] = [within(answer).getByText("REHEMA ALI JUMA"), within(answer).getByRole("button")]
    expect(value.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it("stacks label, answer and link in one group where the row is too narrow", () => {
    const { container } = render(<SummaryRow label="Namba ya simu" value="0712 345 678" action={<ChangeLink onClick={() => {}}>Badilisha Namba</ChangeLink>} />)
    expect(container.querySelector("[data-summary-row]")).toHaveClass("@container")
    expect(container.querySelector("[data-summary-answer]")?.className).toMatch(/@max-\[19rem\]:items-start/)
  })

  it("without a label, keeps the answer beside the dot and the link under it", () => {
    const { container } = render(<SummaryRow value="AMINA · STD 3" action={<ChangeLink onClick={() => {}}>Badilisha</ChangeLink>} />)
    expect(container.querySelector("[data-summary-label]")).toBeNull()
    expect(screen.getByText("AMINA · STD 3")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Badilisha" }).parentElement).toHaveClass("self-end")
  })
})

// The stacked look (owner, agent sign-up prototype v5): the question small on
// top with its link beside it, the answer under them, the only bold text.
describe("SummaryRow stacked", () => {
  it("puts the link on the question's line and the answer under them", () => {
    const { container } = render(
      <SummaryRow stacked label="Phone number" value="0712 345 123" sub="WhatsApp 0754 111 222" action={<ChangeLink small onClick={() => {}}>Change Number</ChangeLink>} />,
    )
    const label = container.querySelector<HTMLElement>("[data-summary-label]")!
    const link = screen.getByRole("button", { name: "Change Number" })
    expect(label.parentElement).toBe(link.parentElement)
    const value = container.querySelector<HTMLElement>("[data-summary-value]")!
    expect(value).toHaveTextContent("0712 345 123")
    expect(value).toHaveClass("font-semibold")
    expect(label.compareDocumentPosition(value) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByText("WhatsApp 0754 111 222")).toBeInTheDocument()
    // The small link: the question's size, not bold.
    expect(link).toHaveClass("text-[13px]", "font-normal")
  })

  it("greys an answer that says there is nothing", () => {
    render(<SummaryRow stacked none label="Discount code" value="None" />)
    expect(screen.getByText("None")).toHaveClass("text-slate-600")
  })
})
