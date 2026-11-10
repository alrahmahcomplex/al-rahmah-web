import { act, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"

import { ProgressBar, type ProgressBarProps } from "@/components/guided-form/progress-bar"

const LABELS = { back: "Rudi", reset: "Anza upya" }

function bar(overrides: Partial<ProgressBarProps> = {}) {
  const props: ProgressBarProps = {
    groups: [
      { label: "Mwanafunzi", steps: 3, done: 1 },
      { label: "Msimamizi", steps: 3, done: 0 },
      { label: "Usaili", steps: 2, done: 0 },
    ],
    activeGroup: 0,
    canBack: true,
    onBack: vi.fn(),
    canReset: false,
    labels: LABELS,
    status: "Mwanafunzi: hatua 2 kati ya 3",
    ...overrides,
  }
  return { props, ...render(<ProgressBar {...props} />) }
}

const chips = (container: HTMLElement, group: number) =>
  [...container.querySelectorAll(`[data-group="${group}"] [data-chip]`)].map((c) => c.getAttribute("data-chip"))

describe("ProgressBar", () => {
  it("draws one chip per step, filled for answered steps and faint for the open one", () => {
    const { container } = bar()

    expect(chips(container, 0)).toEqual(["done", "now", "todo"])
    expect(chips(container, 1)).toEqual(["todo", "todo", "todo"])
    expect(chips(container, 2)).toEqual(["todo", "todo"])
  })

  it("merges a finished group into one bar with the green tick, and only that group", () => {
    const { container } = bar({
      groups: [
        { label: "Mwanafunzi", steps: 3, done: 3 },
        { label: "Msimamizi", steps: 3, done: 1 },
        { label: "Usaili", steps: 2, done: 0 },
      ],
      activeGroup: 1,
    })

    expect(container.querySelector('[data-group="0"]')).toHaveClass("gf-full")
    expect(container.querySelector('[data-group="1"]')).not.toHaveClass("gf-full")
    expect(container.querySelector('[data-group="0"] .gf-ok')).not.toBeNull()
    // Already full on first paint (a restored draft): the number is orange without the cheer.
    expect(container.querySelector('[data-group="0"] .gf-gn')).toHaveClass("gf-won")
  })

  it("turns the number orange once a group fills, and back when it empties", async () => {
    vi.useFakeTimers()
    try {
      const groups = [
        { label: "Mwanafunzi", steps: 3, done: 2 },
        { label: "Msimamizi", steps: 3, done: 0 },
        { label: "Usaili", steps: 2, done: 0 },
      ]
      const { container, rerender, props } = bar({ groups })
      const number = () => container.querySelector('[data-group="0"] .gf-gn')!
      expect(number()).not.toHaveClass("gf-won")

      rerender(<ProgressBar {...props} groups={[{ ...groups[0], done: 3 }, groups[1], groups[2]]} activeGroup={1} />)
      expect(container.querySelector('[data-group="0"]')).toHaveClass("gf-full")
      await act(async () => {
        await vi.advanceTimersByTimeAsync(900)
      })
      expect(number()).toHaveClass("gf-won")

      rerender(<ProgressBar {...props} groups={groups} activeGroup={0} />)
      expect(container.querySelector('[data-group="0"]')).not.toHaveClass("gf-full")
      expect(number()).not.toHaveClass("gf-won")
    } finally {
      vi.useRealTimers()
    }
  })

  it("shows the who label above the first group only while it is active", () => {
    const { container, rerender, props } = bar({ whoLabel: "Mwanafunzi wa pili" })
    const who = container.querySelector(".gf-who")!

    expect(who).toHaveTextContent("Mwanafunzi wa pili")
    expect(who).toHaveClass("gf-on")

    rerender(<ProgressBar {...props} activeGroup={1} />)
    expect(container.querySelector(".gf-who")).not.toHaveClass("gf-on")
  })

  it("offers Back after the first question and Start over on it", async () => {
    const onBack = vi.fn()
    const onReset = vi.fn()
    const { rerender, props } = bar({ onBack, onReset, canReset: true })

    expect(screen.getByRole("button", { name: "Rudi" })).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Anza upya" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Rudi" }))
    expect(onBack).toHaveBeenCalledTimes(1)

    rerender(<ProgressBar {...props} canBack={false} canReset onReset={onReset} />)
    expect(screen.queryByRole("button", { name: "Rudi" })).toBeNull()
    await userEvent.click(screen.getByRole("button", { name: "Anza upya" }))
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it("names the section in the chip and reads progress to screen readers", () => {
    const { container } = bar({ activeGroup: 1, status: "Msimamizi: hatua 1 kati ya 3" })

    expect(container.querySelector(".gf-secname")).toHaveTextContent("Msimamizi")
    expect(container.querySelector('[aria-live="polite"]')).toHaveTextContent("Msimamizi: hatua 1 kati ya 3")
  })
})
