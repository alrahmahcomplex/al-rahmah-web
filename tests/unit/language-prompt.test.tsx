import { act, fireEvent, render, screen } from "@testing-library/react"
import type { RefObject } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const stubs = vi.hoisted(() => ({ setLanguage: vi.fn() }))

vi.mock("@/app/actions/language", () => ({ setLanguage: stubs.setLanguage }))

import { LanguagePrompt } from "@/components/brand/language-prompt"

function menuButton(): RefObject<HTMLButtonElement | null> {
  const button = document.createElement("button")
  document.body.appendChild(button)
  return { current: button }
}

const sentLanguages = () => stubs.setLanguage.mock.calls.map(([data]) => (data as FormData).get("lang"))

const flush = () => act(async () => {})
const wait = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })

beforeEach(() => {
  stubs.setLanguage.mockReset().mockResolvedValue(undefined)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ""
  document.documentElement.style.overflow = ""
})

describe("LanguagePrompt", () => {
  it("stays away when the visitor already has a language cookie", () => {
    render(<LanguagePrompt show={false} language="sw" menuButtonRef={menuButton()} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })

  it("asks in Swahili, with only the English button in English", () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)
    const dialog = screen.getByRole("dialog", { name: "Karibu!" })

    expect(dialog).toHaveAttribute("lang", "sw")
    expect(dialog).toHaveAttribute("aria-modal", "true")
    expect(screen.getByText("Chagua lugha ya fomu hii.")).toBeInTheDocument()
    expect(screen.getByText("Unaweza kubadilisha lugha baadaye kwenye Menyu.")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Endelea kwa Kiswahili" })).toHaveFocus()
    expect(screen.getByRole("button", { name: "Continue in English" })).toHaveAttribute("lang", "en")
    expect(document.documentElement.style.overflow).toBe("hidden")
  })

  it.each([
    ["Endelea kwa Kiswahili", "sw"],
    ["Continue in English", "en"],
  ])("on %s, sets the cookie to %s and shrinks straight into the menu button, with no confirmation", async (name, lang) => {
    const ref = menuButton()
    render(<LanguagePrompt show language="sw" menuButtonRef={ref} />)

    fireEvent.click(screen.getByRole("button", { name }))
    await flush()

    expect(sentLanguages()).toEqual([lang])
    expect(screen.queryByRole("status")).toBeNull()
    // jsdom has no Element.animate, so the shrink finishes at once.
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(ref.current).toHaveClass("gf-catch")
    expect(document.documentElement.style.overflow).toBe("")
  })

  it("sends only the first pick while the card is still shrinking", async () => {
    // A shrink that never ends, so the second button is still there to press.
    const animate = vi.fn(() => ({ onfinish: null, cancel: () => {} }) as unknown as Animation)
    Object.defineProperty(HTMLElement.prototype, "animate", { value: animate, configurable: true })
    try {
      render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)

      fireEvent.click(screen.getByRole("button", { name: "Continue in English" }))
      fireEvent.click(screen.getByRole("button", { name: "Endelea kwa Kiswahili" }))
      await flush()

      expect(sentLanguages()).toEqual(["en"])
    } finally {
      delete (HTMLElement.prototype as { animate?: unknown }).animate
    }
  })

  it("waits for a pick however long the card sits untouched", async () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)

    await wait(10 * 60 * 1000)

    expect(stubs.setLanguage).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Endelea kwa Kiswahili" })).toBeInTheDocument()
  })

  it("keeps focus on the two buttons with Tab", () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)
    const dialog = screen.getByRole("dialog")

    fireEvent.keyDown(dialog, { key: "Tab" })
    expect(screen.getByRole("button", { name: "Continue in English" })).toHaveFocus()
    fireEvent.keyDown(dialog, { key: "Tab" })
    expect(screen.getByRole("button", { name: "Endelea kwa Kiswahili" })).toHaveFocus()
  })

  it("stays open on Escape or a tap outside the card", async () => {
    const { container } = render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    fireEvent.click(container.querySelector(".gf-lp-back")!)
    await wait(1000)

    expect(stubs.setLanguage).not.toHaveBeenCalled()
    expect(screen.getByRole("dialog")).toBeInTheDocument()
  })

  it("finishes even when the page re-renders without the prompt", async () => {
    const ref = menuButton()
    const { rerender } = render(<LanguagePrompt show language="sw" menuButtonRef={ref} />)

    fireEvent.click(screen.getByRole("button", { name: "Continue in English" }))
    rerender(<LanguagePrompt show={false} language="en" menuButtonRef={ref} />)
    await flush()

    expect(sentLanguages()).toEqual(["en"])
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(ref.current).toHaveClass("gf-catch")
  })
})
