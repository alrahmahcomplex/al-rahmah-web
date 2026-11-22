import { render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

const spend = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/components/kit/confetti", () => ({ rainConfetti: vi.fn() }))
vi.mock("@/app/discount-code/students/actions", () => ({ spendWelcome: spend }))

import { WaitingCode } from "@/app/discount-code/students/waiting"

// A new agent's waiting code (#503 slice 4d-b): signed in by mobile while the
// office has yet to approve it, they see what today's finish shows and when
// their password will work (O-N62). No students, no discount.

const LINK = "https://alrahmah.example/apply?ref=RAJ-124"

describe("WaitingCode", () => {
  it("shows the code, its link with Copy and Share, the confirm note and when to sign in again", () => {
    render(<WaitingCode language="sw" code="RAJ-124" link={LINK} officePhone="+255 700 000 001" justJoined={false} />)
    expect(screen.getByRole("heading", { name: "Code yako ya Punguzo" })).toBeInTheDocument()
    expect(screen.getByText("RAJ-124")).toBeInTheDocument()
    expect(screen.getByText(LINK)).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Nakili kiungo" })).toBeInTheDocument()
    // A waiting code takes nothing off yet: the message names no figure.
    const share = screen.getByRole("link", { name: "Shiriki kwenye WhatsApp" })
    expect(decodeURIComponent(share.getAttribute("href") ?? "")).not.toMatch(/TZS/)
    expect(screen.getByText(/Punguzo litaanza kufanya kazi Ofisi ya Masoko itakapothibitisha code yako/)).toBeInTheDocument()
    expect(screen.getByText("Ofisi ya Masoko ikithibitisha code yako, ingia kwa namba yako ya simu na nenosiri hili kuona wanafunzi uliowaleta.")).toBeInTheDocument()
    // No way to the students before the approval.
    expect(screen.queryByRole("link", { name: "Ona Wanafunzi Niliowaleta" })).not.toBeInTheDocument()
  })

  it("speaks English when the page does", () => {
    render(<WaitingCode language="en" code="RAJ-124" link={LINK} officePhone="+255 700 000 001" justJoined={false} />)
    expect(screen.getByText("Once the Marketing Office confirms your code, sign in with your mobile number and this password to see the students you referred.")).toBeInTheDocument()
  })

  it("shows the finish mark only right after the password is set, and keeps it through the refresh that spends the greeting", () => {
    const { container, rerender, unmount } = render(<WaitingCode language="sw" code="RAJ-124" link={LINK} officePhone="+255 700 000 001" justJoined />)
    const marked = container.querySelectorAll("svg").length
    // The greeting is spent at once, so a later visit shows the page without it.
    expect(spend).toHaveBeenCalledTimes(1)
    // Spending it refreshes the page with justJoined false: the mark stays until its drawing ends (Sol, #538).
    rerender(<WaitingCode language="sw" code="RAJ-124" link={LINK} officePhone="+255 700 000 001" justJoined={false} />)
    expect(container.querySelectorAll("svg").length).toBe(marked)
    unmount()
    // A later visit, with the greeting spent: no mark.
    const later = render(<WaitingCode language="sw" code="RAJ-124" link={LINK} officePhone="+255 700 000 001" justJoined={false} />)
    expect(later.container.querySelectorAll("svg").length).toBeLessThan(marked)
  })
})
