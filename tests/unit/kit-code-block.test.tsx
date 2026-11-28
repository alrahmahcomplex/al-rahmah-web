import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { CodeBlock, PasswordField } from "@/components/kit"

// The design site round's two kit parts: the code block and the password field.

afterEach(() => vi.unstubAllGlobals())

const COPY = { copyLabel: "Copy settings", copiedMessage: "Copied", copyFailedMessage: "Couldn’t copy. The text is selected: press Ctrl+C." }

describe("CodeBlock", () => {
  it("copies what it is given, not what it shows", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText } })
    render(<CodeBlock copyValue="Bearer real-secret" {...COPY}>Bearer ••••••••</CodeBlock>)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy settings" })))
    expect(writeText).toHaveBeenCalledWith("Bearer real-secret")
    expect(screen.getByText("Bearer ••••••••")).toBeInTheDocument()
  })

  it("when the clipboard is refused, shows and selects the real text so it can be copied by hand", async () => {
    vi.stubGlobal("navigator", { ...navigator, clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) } })
    render(<CodeBlock copyValue="Bearer real-secret" {...COPY}>Bearer ••••••••</CodeBlock>)
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "Copy settings" })))
    expect(screen.getByText("Bearer real-secret")).toBeInTheDocument()
    expect(window.getSelection()?.toString()).toBe("Bearer real-secret")
  })

  it("holds no copy button until there is something to copy", () => {
    render(<CodeBlock copyValue={null} {...COPY}>Bearer ••••••••</CodeBlock>)
    expect(screen.queryByRole("button", { name: "Copy settings" })).toBeNull()
  })
})

describe("PasswordField", () => {
  it("hides the password until the eye is pressed, then hides it again", () => {
    render(<PasswordField aria-label="Password" showLabel="Show password" hideLabel="Hide password" defaultValue="sample" />)
    const field = screen.getByLabelText("Password")
    expect(field).toHaveAttribute("type", "password")
    fireEvent.click(screen.getByRole("button", { name: "Show password" }))
    expect(field).toHaveAttribute("type", "text")
    expect(screen.getByRole("button", { name: "Hide password" })).toHaveAttribute("aria-pressed", "true")
    fireEvent.click(screen.getByRole("button", { name: "Hide password" }))
    expect(field).toHaveAttribute("type", "password")
  })
})
