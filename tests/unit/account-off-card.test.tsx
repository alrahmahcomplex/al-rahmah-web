import { render, screen, within } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))
vi.mock("@/app/actions/session", () => ({ signOutAndReturn: vi.fn() }))

import { AccountOffCard } from "@/app/discount-code/account-off"
import { OFFICE_PHONE } from "@/lib/office"

// The students page's card for a paused or closed Discount code (#497 state 6).
describe("AccountOffCard", () => {
  it.each([
    ["switched-off", "sw", "Code yako imesimamishwa", "Ofisi ya Masoko imesimamisha Code yako ya Punguzo kwa sasa.", "Toka"],
    ["switched-off", "en", "Your code is paused", "The Marketing Office has paused your Discount code for now.", "Sign out"],
    ["retired", "sw", "Code hii haitumiki tena", "Ofisi ya Masoko imefunga Code hii ya Punguzo.", "Toka"],
    ["retired", "en", "This code is no longer in use", "The Marketing Office has closed this Discount code.", "Sign out"],
    ["access-off", "sw", "Kurasa hizi zimesimamishwa kwa muda", "Tumesimamisha kurasa hizi kwa kila mtu kwa muda. Code yako haijaathirika.", "Toka"],
    ["access-off", "en", "These pages are paused for now", "We've paused these pages for everyone for a while. Your code isn't affected.", "Sign out"],
  ] as const)("on %s in %s, shows its title, its sentence, Sign out and the office, and no reason code", (reason, language, title, text, signOut) => {
    render(<AccountOffCard language={language} reason={reason} />)
    const card = screen.getByRole("alert")

    expect(within(card).getByRole("heading", { name: title })).toBeInTheDocument()
    expect(card).toHaveTextContent(text)
    const button = within(card).getByRole("button", { name: signOut })
    expect(button.closest("form")?.querySelector('input[name="back"]')).toHaveValue("/auth")
    expect(within(card).getByRole("link", { name: OFFICE_PHONE })).toHaveAttribute("href", `tel:${OFFICE_PHONE.replaceAll(" ", "")}`)
    expect(card).not.toHaveTextContent(/switched_off|retired\b|access_off|Msimbo|Code: /)
  })
})
