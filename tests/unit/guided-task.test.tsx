import { render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { ProgressBar, type ProgressBarProps } from "@/components/guided-form/progress-bar"
import { revealStep } from "@/components/guided-form/stack"
import { GuidedReveal, GuidedTask } from "@/components/kit"

const rain = vi.hoisted(() => vi.fn())
vi.mock("@/components/kit/confetti", () => ({ rainConfetti: rain }))

const PROGRESS: ProgressBarProps = {
  groups: [
    { label: "Students", steps: 3, done: 1 },
    { label: "Custodians", steps: 1, done: 0 },
    { label: "Finish", steps: 2, done: 0 },
  ],
  activeGroup: 0,
  canBack: true,
  onBack: () => {},
  canReset: false,
  labels: { back: "Back", reset: "Start over" },
  status: "Students: 1 of 3",
}

afterEach(() => {
  rain.mockClear()
  vi.restoreAllMocks()
})

describe("ProgressBar icons", () => {
  it("keeps the Admission form's icons unless a staff page asks for the kit's", () => {
    const { container, rerender } = render(<ProgressBar {...PROGRESS} />)
    expect(container.querySelectorAll("[data-icon-host]")).toHaveLength(0)
    expect(container.querySelectorAll(".gf-round svg.gf-icon")).toHaveLength(2)

    rerender(<ProgressBar {...PROGRESS} kitIcons />)
    expect(container.querySelectorAll("button[data-icon-host]")).toHaveLength(2)
    expect(container.querySelectorAll(".gf-round svg.gf-ic")).toHaveLength(2)
    // Set 1: Start over has its arrow as a second line that turns orange on hover; Back is a plain chevron, as in the prototype.
    expect(screen.getByRole("button", { name: "Back", hidden: true }).querySelector(".gf-ic-detail")).toBeNull()
    expect(container.querySelector(".gf-reset .gf-ic-detail")).not.toBeNull()
  })
})

describe("GuidedTask", () => {
  it("holds the progress bar and the questions in one lifted card, in the 640px column", () => {
    const { container } = render(
      <GuidedTask progress={PROGRESS}>
        <ol>
          <li>Question</li>
        </ol>
      </GuidedTask>,
    )
    const card = container.querySelector(".kit-guided > .kit-task")!
    expect(card.querySelector(".gf-bar-row [data-icon-host]")).not.toBeNull()
    expect(card).toHaveTextContent("Question")
    expect(rain).not.toHaveBeenCalled()
  })

  it("gives way to the finished screen: results, actions, focus on the title, confetti once", () => {
    const finished = {
      title: "2 students registered",
      hint: "Give the family these Admission Numbers.",
      results: [
        { label: "Neema Juma Salim Mrisho", value: "DMSN-90013" },
        { label: "Hamisi Juma Salim Mrisho", value: "DMSN-90014" },
      ],
      children: <button type="button">Register another family</button>,
    }
    const { container, rerender } = render(<GuidedTask progress={PROGRESS} finished={finished}>{null}</GuidedTask>)
    expect(container.querySelector(".gf-bar-row")).toBeNull()
    const title = screen.getByRole("heading", { name: "2 students registered" })
    expect(title).toHaveFocus()
    expect(screen.getByText("DMSN-90014")).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Register another family" })).toBeInTheDocument()
    rerender(<GuidedTask progress={PROGRESS} finished={{ ...finished }}>{null}</GuidedTask>)
    expect(rain).toHaveBeenCalledTimes(1)
    // The burst starts from the finished card's own mark.
    expect(rain).toHaveBeenCalledWith(container.querySelector(".kit-mark"))
  })
})

describe("GuidedReveal", () => {
  it("is inert until it opens", () => {
    const { container, rerender } = render(
      <GuidedReveal open={false}>
        <button type="button">Continue</button>
      </GuidedReveal>,
    )
    const reveal = container.firstElementChild!
    expect(reveal).toHaveAttribute("inert")
    expect(reveal).not.toHaveAttribute("data-open")
    rerender(
      <GuidedReveal open>
        <button type="button">Continue</button>
      </GuidedReveal>,
    )
    expect(reveal).not.toHaveAttribute("inert")
    expect(reveal).toHaveAttribute("data-open")
  })
})

describe("revealStep", () => {
  const at = (el: Element, top: number) => vi.spyOn(el, "getBoundingClientRect").mockReturnValue({ top } as DOMRect)

  it("scrolls the stage's scroll area, not the window, inside a staff stage", () => {
    const area = document.createElement("div")
    area.setAttribute("data-stage-scroll", "")
    const li = document.createElement("li")
    area.appendChild(li)
    document.body.appendChild(area)
    Object.defineProperty(area, "clientHeight", { value: 800 })
    area.scrollTop = 100
    area.scrollTo = vi.fn() as never
    const win = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    at(area, 60)
    at(li, 760)

    revealStep(li)
    // 700px down the area: brought up to 18% of its height.
    expect(area.scrollTo).toHaveBeenCalledWith({ top: 100 + 700 - 144, behavior: "smooth" })
    expect(win).not.toHaveBeenCalled()
    area.remove()
  })

  it("scrolls the window on the public forms", () => {
    const li = document.createElement("li")
    document.body.appendChild(li)
    const win = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    at(li, window.innerHeight * 0.8)
    revealStep(li)
    expect(win).toHaveBeenCalledTimes(1)
    li.remove()
  })

  describe("with a phone keyboard leaving the top 400px free", () => {
    const step = (liTop: number, boxTop: number) => {
      const li = document.createElement("li")
      const box = document.createElement("input")
      li.appendChild(box)
      document.body.appendChild(li)
      at(li, liTop)
      vi.spyOn(box, "getBoundingClientRect").mockReturnValue({ top: boxTop, bottom: boxTop + 52 } as DOMRect)
      box.focus()
      return li
    }
    beforeEach(() => vi.stubGlobal("visualViewport", { offsetTop: 0, height: 400 }))
    afterEach(() => {
      vi.unstubAllGlobals()
      document.body.replaceChildren()
    })

    it("scrolls on until the focused box is above the keyboard, not just the step's head", () => {
      const win = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
      revealStep(step(300, 700))
      // The head alone would need 300 - 72 = 228px; the box's foot (752) must reach 400 - 16.
      expect(win).toHaveBeenCalledWith({ top: 752 - 384, behavior: "smooth" })
    })

    it("still scrolls when the head is in place but the keyboard covers the box", () => {
      const win = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
      revealStep(step(100, 500))
      expect(win).toHaveBeenCalledWith({ top: 552 - 384, behavior: "smooth" })
    })

    it("leaves the head's scroll alone when the box ends up in the free space", () => {
      const win = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
      revealStep(step(300, 330))
      // 330 - 228 = 102: below the 84px bar and above the keyboard.
      expect(win).toHaveBeenCalledWith({ top: 228, behavior: "smooth" })
    })

    it("never scrolls the box up under the sticky bar", () => {
      const win = vi.spyOn(window, "scrollTo").mockImplementation(() => {})
      revealStep(step(300, 250))
      // 250 - 228 = 22 would hide it under the 84px bar: stop at 250 - 84.
      expect(win).toHaveBeenCalledWith({ top: 250 - 84, behavior: "smooth" })
    })
  })
})
