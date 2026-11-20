import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MessagePicker } from "@/app/discount-code/students/dashboard"

const LINK = "https://alrahmah.example/apply?ref=ABK-014"
const WORDS = {
  pickMessage: "Chagua ujumbe",
  labels: { parent: "Kwa mzazi", group: "Kwa kikundi", short: "Fupi" },
  share: "Shiriki kwenye WhatsApp",
  copyMessage: "Nakili ujumbe",
  messageCopied: "Ujumbe umenakiliwa",
  copyLink: "Nakili kiungo",
  linkCopied: "Kiungo kimenakiliwa",
  copyFailed: "Hatukuweza kunakili. Bonyeza kiungo kwa muda kisha ukinakili.",
}
const MESSAGES = { parent: `Kwa mzazi: ${LINK}`, group: `Kwa kikundi: ${LINK}`, short: `Fupi: ${LINK}` }

afterEach(() => vi.restoreAllMocks())

// The agent dashboard's message picker (#497).
describe("the message picker", () => {
  it("sends the picked message on WhatsApp, with no number", async () => {
    const user = userEvent.setup()
    render(<MessagePicker messages={MESSAGES} link={LINK} words={WORDS} />)
    await user.click(screen.getByRole("button", { name: "Fupi" }))

    expect(screen.getByRole("button", { name: "Fupi" })).toHaveAttribute("aria-pressed", "true")
    const href = screen.getByRole("link", { name: "Shiriki kwenye WhatsApp" }).getAttribute("href")!
    expect(href.startsWith("https://wa.me/?text=")).toBe(true)
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toBe(MESSAGES.short)
  })

  it("shows the link to copy by hand, and says why, when the browser refuses to copy it", async () => {
    const user = userEvent.setup()
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"))
    render(<MessagePicker messages={MESSAGES} link={LINK} words={WORDS} />)
    expect(screen.queryByText(LINK)).not.toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Nakili kiungo" }))

    expect(await screen.findByText(LINK)).toBeInTheDocument()
    expect(screen.getByText(WORDS.copyFailed)).toBeInTheDocument()
  })
})
