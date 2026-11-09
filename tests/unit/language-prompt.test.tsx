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

  it("on English, sets the cookie to en and turns the card English with a spinner", async () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)

    fireEvent.click(screen.getByRole("button", { name: "Continue in English" }))
    await flush()

    expect(sentLanguages()).toEqual(["en"])
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Changing the language to English. Please wait a moment…")
    expect(status.querySelector('[data-icon="spinner"]')).not.toBeNull()
    expect(screen.getByRole("dialog")).toHaveAttribute("lang", "en")
    expect(screen.queryByRole("button", { name: "Continue in English" })).toBeNull()
  })

  it("on Kiswahili, sets the cookie to sw, shows the tick, then shrinks into the menu button after 3 seconds", async () => {
    const ref = menuButton()
    render(<LanguagePrompt show language="sw" menuButtonRef={ref} />)

    fireEvent.click(screen.getByRole("button", { name: "Endelea kwa Kiswahili" }))
    await flush()

    expect(sentLanguages()).toEqual(["sw"])
    const status = screen.getByRole("status")
    expect(status).toHaveTextContent("Fomu imewekwa kwa Kiswahili.")
    expect(status.querySelector('[data-icon="tick"]')).not.toBeNull()

    await wait(3100)
    expect(screen.queryByRole("dialog")).toBeNull()
    expect(ref.current).toHaveClass("gf-catch")
    expect(document.documentElement.style.overflow).toBe("")
  })

  it("after 5 seconds untouched, takes the Kiswahili path", async () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)

    await wait(4900)
    expect(stubs.setLanguage).not.toHaveBeenCalled()

    await wait(200)
    expect(sentLanguages()).toEqual(["sw"])
    expect(screen.getByRole("status")).toHaveTextContent("Fomu imewekwa kwa Kiswahili.")
  })

  it("stops the 5 seconds once the keyboard is used in the card", async () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Tab" })
    expect(screen.getByRole("button", { name: "Continue in English" })).toHaveFocus()
    await wait(8000)

    expect(stubs.setLanguage).not.toHaveBeenCalled()
    expect(screen.getByRole("button", { name: "Endelea kwa Kiswahili" })).toBeInTheDocument()
  })

  it("pauses the 5 seconds while a mouse is over the card", async () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)
    const dialog = screen.getByRole("dialog")

    fireEvent.pointerEnter(dialog, { pointerType: "mouse" })
    await wait(8000)
    expect(stubs.setLanguage).not.toHaveBeenCalled()

    fireEvent.pointerLeave(dialog, { pointerType: "mouse" })
    await wait(5100)
    expect(sentLanguages()).toEqual(["sw"])
  })

  it("treats Escape as Kiswahili", async () => {
    render(<LanguagePrompt show language="sw" menuButtonRef={menuButton()} />)

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await flush()

    expect(sentLanguages()).toEqual(["sw"])
  })

  it("finishes even when the page re-renders without the prompt", async () => {
    const ref = menuButton()
    const { rerender } = render(<LanguagePrompt show language="sw" menuButtonRef={ref} />)

    fireEvent.click(screen.getByRole("button", { name: "Continue in English" }))
    rerender(<LanguagePrompt show={false} language="en" menuButtonRef={ref} />)
    await flush()

    expect(screen.getByRole("status")).toHaveTextContent("Changing the language to English.")
  })
})
