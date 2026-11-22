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
