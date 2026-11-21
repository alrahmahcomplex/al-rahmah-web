import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"

import { MessagePicker, Reminders, type ReminderItem } from "@/app/discount-code/students/dashboard"

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

// "Wanaweza kukumbushwa": the five longest waits, then "Ona wote (n)" (decision 67).
describe("the reminders", () => {
  const reminders = (count: number): ReminderItem[] =>
    Array.from({ length: count }, (_, index) => ({
      name: `Mtoto ${index + 1}`,
      className: "STD 3",
      waiting: `Alijisajili siku ${40 - index} zilizopita, bado hajatembelea shule.`,
      message: `Habari! Mtoto ${index + 1}`,
    }))
  const words = (count: number) => ({
    heading: `Wanaweza kukumbushwa (${count})`,
    seeAll: `Ona wote (${count})`,
    prepare: "Andaa ujumbe",
    title: "Ujumbe wa kukumbusha",
    openWhatsApp: "Fungua WhatsApp",
    copyMessage: "Nakili ujumbe",
    messageCopied: "Ujumbe umenakiliwa",
    close: "Funga",
  })
  const names = () => screen.getAllByRole("listitem").map((item) => item.querySelector("p")?.textContent?.split(" ·")[0])

  it("shows the five longest waits under the full count, and the rest in place, in the same order", async () => {
    const user = userEvent.setup()
    render(<Reminders items={reminders(7)} words={words(7)} />)

    expect(screen.getByRole("heading", { name: "Wanaweza kukumbushwa (7)" })).toBeInTheDocument()
    expect(names()).toEqual(["Mtoto 1", "Mtoto 2", "Mtoto 3", "Mtoto 4", "Mtoto 5"])

    await user.click(screen.getByRole("button", { name: "Ona wote (7)" }))
    expect(names()).toEqual(["Mtoto 1", "Mtoto 2", "Mtoto 3", "Mtoto 4", "Mtoto 5", "Mtoto 6", "Mtoto 7"])
    expect(screen.queryByRole("button", { name: "Ona wote (7)" })).not.toBeInTheDocument()

    // A reminder shown after the click opens its own message.
    await user.click(screen.getAllByRole("button", { name: "Andaa ujumbe" })[6])
    expect(await screen.findByText("Habari! Mtoto 7")).toBeInTheDocument()
  })

  it("hands keyboard focus to the first reminder it reveals", async () => {
    const user = userEvent.setup()
    render(<Reminders items={reminders(7)} words={words(7)} />)
    screen.getByRole("button", { name: "Ona wote (7)" }).focus()
    await user.keyboard("{Enter}")

    const sixth = screen.getAllByRole("listitem")[5]
    expect(sixth).toHaveTextContent("Mtoto 6")
    expect(sixth.querySelector("button")).toHaveFocus()
    await user.keyboard("{Enter}")
    expect(await screen.findByText("Habari! Mtoto 6")).toBeInTheDocument()
  })

  it("offers no 'Ona wote' with five or fewer", () => {
    render(<Reminders items={reminders(5)} words={words(5)} />)
    expect(screen.getAllByRole("listitem")).toHaveLength(5)
    expect(screen.queryByRole("button", { name: /Ona wote/ })).not.toBeInTheDocument()
  })
})
