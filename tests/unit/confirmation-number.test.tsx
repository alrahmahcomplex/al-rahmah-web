import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { createRef } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { ConfirmationNumber, type ConfirmationNumberHandle, type ConfirmationResult } from "@/components/guided-form"

// The confirmation-number boxes (#503, prototype v57): typing, Backspace and
// the arrows, paste and autofill, focus never skipping ahead, the lock while
// the number is checked, and the result once the animation has played.

function renderBoxes(answer: ConfirmationResult = "ok") {
  const onComplete = vi.fn(async () => answer)
  const onSettled = vi.fn()
  const ref = createRef<ConfirmationNumberHandle>()
  render(<ConfirmationNumber ref={ref} label="Namba ya kuthibitisha" digitLabel={(n) => `Tarakimu ${n} kati ya 6`} onComplete={onComplete} onSettled={onSettled} />)
  const boxes = screen.getAllByRole("textbox")
  return { onComplete, onSettled, ref, boxes }
}

afterEach(() => {
  vi.useRealTimers()
})

describe("ConfirmationNumber", () => {
  it("names the group and every box", () => {
    const { boxes } = renderBoxes()
    expect(screen.getByRole("group", { name: "Namba ya kuthibitisha" })).toBeInTheDocument()
    expect(boxes.map((box) => box.getAttribute("aria-label"))).toEqual([1, 2, 3, 4, 5, 6].map((n) => `Tarakimu ${n} kati ya 6`))
    expect(boxes[0]).toHaveAttribute("autocomplete", "one-time-code")
    expect(boxes[1]).toHaveAttribute("autocomplete", "off")
    expect(boxes[0]).toHaveAttribute("inputmode", "numeric")
  })

  it("takes one digit per box, moves on, and sends itself on the sixth", async () => {
    const { boxes, onComplete } = renderBoxes()
    await userEvent.click(boxes[0])
    await userEvent.keyboard("12a3")
    expect(boxes.slice(0, 3).map((b) => (b as HTMLInputElement).value)).toEqual(["1", "2", "3"])
    expect(boxes[3]).toHaveFocus()
    expect(onComplete).not.toHaveBeenCalled()
    await userEvent.keyboard("456")
    expect(onComplete).toHaveBeenCalledWith("123456")
    expect(onComplete).toHaveBeenCalledTimes(1)
  })

  it("goes back on Backspace in an empty box, and the arrows move", async () => {
    const { boxes } = renderBoxes()
    await userEvent.click(boxes[0])
    await userEvent.keyboard("12")
    expect(boxes[2]).toHaveFocus()
    await userEvent.keyboard("{Backspace}")
    expect(boxes[1]).toHaveFocus()
    expect((boxes[1] as HTMLInputElement).value).toBe("")
    await userEvent.keyboard("{ArrowLeft}")
    expect(boxes[0]).toHaveFocus()
    await userEvent.keyboard("{ArrowRight}")
    expect(boxes[1]).toHaveFocus()
  })

  it("never lets focus skip ahead: a later box sends it to the first empty one", async () => {
    const { boxes } = renderBoxes()
    await userEvent.click(boxes[4])
    expect(boxes[0]).toHaveFocus()
  })

  it("spreads a six-digit paste into any box and sends it", async () => {
    const { boxes, onComplete } = renderBoxes()
    await userEvent.click(boxes[0])
    await userEvent.paste("739 204")
    expect(boxes.map((b) => (b as HTMLInputElement).value)).toEqual(["7", "3", "9", "2", "0", "4"])
    expect(onComplete).toHaveBeenCalledWith("739204")
  })

  it("spreads a shorter paste from the box it lands in", async () => {
    const { boxes, onComplete } = renderBoxes()
    await userEvent.click(boxes[0])
    await userEvent.keyboard("1")
    await userEvent.paste("23")
    expect(boxes.slice(0, 3).map((b) => (b as HTMLInputElement).value)).toEqual(["1", "2", "3"])
    expect(boxes[3]).toHaveFocus()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it("takes an SMS autofill of all six digits into the first box", async () => {
    const { boxes, onComplete } = renderBoxes()
    await userEvent.click(boxes[0])
    // Autofill puts the whole number into the one-time-code box at once.
    fireEvent.change(boxes[0], { target: { value: "246810" } })
    await waitFor(() => expect(onComplete).toHaveBeenCalledWith("246810"))
    expect(boxes.map((b) => (b as HTMLInputElement).value)).toEqual(["2", "4", "6", "8", "1", "0"])
  })

  it("locks the boxes while the number is checked, then settles after the animation", async () => {
    let answer: (result: ConfirmationResult) => void = () => {}
    const onComplete = vi.fn(() => new Promise<ConfirmationResult>((resolve) => (answer = resolve)))
    const onSettled = vi.fn()
    render(<ConfirmationNumber label="n" digitLabel={(n) => `d${n}`} onComplete={onComplete} onSettled={onSettled} />)
    const boxes = screen.getAllByRole("textbox")
    await userEvent.click(boxes[0])
    await userEvent.paste("000000")
    expect(boxes[0]).toHaveAttribute("readonly")
    expect(screen.getByRole("group").parentElement).toHaveAttribute("aria-busy", "true")

    vi.useFakeTimers()
    await act(async () => answer("bad"))
    expect(screen.getByRole("group").parentElement).toHaveAttribute("data-state", "bad")
    expect(onSettled).not.toHaveBeenCalled()
    await act(async () => {
      vi.advanceTimersByTime(2000)
    })
    expect(onSettled).toHaveBeenCalledWith("bad", "000000")
  })

  it("empties the boxes and focuses the first on reset", async () => {
    const { boxes, ref, onSettled } = renderBoxes("bad")
    await userEvent.click(boxes[0])
    await userEvent.paste("000000")
    await waitFor(() => expect(onSettled).toHaveBeenCalled(), { timeout: 3000 })
    await act(async () => ref.current?.reset())
    await waitFor(() => expect(boxes[0]).toHaveFocus())
    expect(boxes.every((b) => (b as HTMLInputElement).value === "")).toBe(true)
    expect(boxes[0]).not.toHaveAttribute("readonly")
  })

  it("ignores a late answer to a check that a reset left behind", async () => {
    let answer: (result: ConfirmationResult) => void = () => {}
    const onComplete = vi.fn(() => new Promise<ConfirmationResult>((resolve) => (answer = resolve)))
    const onSettled = vi.fn()
    const ref = createRef<ConfirmationNumberHandle>()
    render(<ConfirmationNumber ref={ref} label="n" digitLabel={(n) => `d${n}`} onComplete={onComplete} onSettled={onSettled} />)
    const boxes = screen.getAllByRole("textbox")
    await userEvent.click(boxes[0])
    await userEvent.paste("000000")
    await act(async () => ref.current?.reset())
    await act(async () => answer("bad"))
    expect(screen.getByRole("group").parentElement).toHaveAttribute("data-state", "idle")
    expect(boxes[0]).not.toHaveAttribute("readonly")
    await new Promise((resolve) => setTimeout(resolve, 1200))
    expect(onSettled).not.toHaveBeenCalled()
  })

  it("treats a check that throws as a wrong number", async () => {
    const onComplete = vi.fn(async (): Promise<ConfirmationResult> => {
      throw new Error("offline")
    })
    render(<ConfirmationNumber label="n" digitLabel={(n) => `d${n}`} onComplete={onComplete} />)
    const boxes = screen.getAllByRole("textbox")
    await userEvent.click(boxes[0])
    await userEvent.paste("123456")
    await waitFor(() => expect(screen.getByRole("group").parentElement).toHaveAttribute("data-state", "bad"))
  })
})
