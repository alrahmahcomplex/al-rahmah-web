import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"

import { ChoiceTiles, LastNameChoice, TypeAheadField, type TypeAheadOption } from "@/components/guided-form"
import { ProgressBar } from "@/components/guided-form/progress-bar"
import type { LastNameFrom } from "@/lib/names"

// The kit parts Register students and Check-in take from prototype v50 to v55 (#511).

const OPTIONS: TypeAheadOption[] = [
  { value: "Outside Tanzania", label: "Outside Tanzania (Other Country)" },
  { value: "Arusha", label: "Arusha" },
  { value: "Kagera", label: "Kagera" },
  { value: "Katavi", label: "Katavi" },
  { value: "Pwani", label: "Pwani" },
]
const LABELS = {
  field: "Region",
  placeholder: "Type or choose a region",
  showAll: "Show all regions",
  search: "Search regions",
  list: "Regions",
  none: (q: string) => `No region matches “${q}”.`,
}

function Region({ onPick = () => {} }: { onPick?: (v: string, how: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <>
      <TypeAheadField
        options={OPTIONS}
        pinned="Outside Tanzania"
        value={value}
        onValueChange={(v, how) => {
          setValue(v)
          onPick(v, how)
        }}
        labels={LABELS}
      />
      <output>{value || "none"}</output>
    </>
  )
}

describe("TypeAheadField", () => {
  it("shows the rest of the best match faintly and takes it with Tab", async () => {
    const onPick = vi.fn()
    const { container } = render(<Region onPick={onPick} />)
    const box = screen.getByRole("combobox", { name: "Region" })
    await userEvent.type(box, "kag")
    expect(container.querySelector(".gf-ta-rest")).toHaveTextContent("era")
    expect(screen.getByRole("status")).toHaveTextContent("none")
    await userEvent.tab()
    expect(box).toHaveValue("Kagera")
    expect(screen.getByRole("status")).toHaveTextContent("Kagera")
    expect(onPick).toHaveBeenLastCalledWith("Kagera", "key")
  })

  it("takes the match with Space only when one option fits", async () => {
    render(<Region />)
    const box = screen.getByRole("combobox", { name: "Region" })
    await userEvent.type(box, "ka ")
    expect(box).toHaveValue("ka ")
    await userEvent.clear(box)
    await userEvent.type(box, "pw ")
    expect(box).toHaveValue("Pwani")
  })

  it("counts a whole name typed in any capitals, and nothing else", async () => {
    render(<Region />)
    const box = screen.getByRole("combobox", { name: "Region" })
    await userEvent.type(box, "arusha")
    expect(screen.getByRole("status")).toHaveTextContent("Arusha")
    await userEvent.type(box, "x")
    expect(screen.getByRole("status")).toHaveTextContent("none")
  })

  it("opens the list with the pinned option first, searches it and picks with Enter", async () => {
    const onPick = vi.fn()
    render(<Region onPick={onPick} />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    const list = screen.getByRole("listbox", { name: "Regions" })
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Outside Tanzania (Other Country)", "Arusha", "Kagera", "Katavi", "Pwani"])
    const find = screen.getByRole("combobox", { name: "Search regions" })
    await userEvent.type(find, "tav")
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["Katavi"])
    await userEvent.keyboard("{Enter}")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("combobox", { name: "Region" })).toHaveValue("Katavi")
    expect(onPick).toHaveBeenLastCalledWith("Katavi", "pick")
  })

  it("says when the search finds nothing, and Escape closes the list", async () => {
    render(<Region />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    await userEvent.type(screen.getByRole("combobox", { name: "Search regions" }), "zz")
    expect(screen.getByText("No region matches “zz”.")).toBeInTheDocument()
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("combobox", { name: "Region" })).toHaveFocus()
  })

  it("picks the option the arrows moved to with Enter, not the faint match", async () => {
    render(<Region />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    await userEvent.type(screen.getByRole("combobox", { name: "Search regions" }), "ka")
    await userEvent.keyboard("{ArrowDown}{Enter}")
    expect(screen.getByRole("combobox", { name: "Region" })).toHaveValue("Katavi")
  })

  it("moves the caret with Right arrow inside the search, and takes the match only at its end", async () => {
    render(<Region />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    const find = screen.getByRole("combobox", { name: "Search regions" })
    await userEvent.type(find, "kag")
    await userEvent.keyboard("{ArrowLeft}{ArrowRight}")
    expect(screen.getByRole("listbox", { name: "Regions" })).toBeInTheDocument()
    await userEvent.keyboard("{ArrowRight}")
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("combobox", { name: "Region" })).toHaveValue("Kagera")
  })

  it("keeps the letters left when a picked name is edited", async () => {
    render(<Region />)
    const box = screen.getByRole("combobox", { name: "Region" })
    await userEvent.type(box, "arusha")
    expect(screen.getByRole("status")).toHaveTextContent("Arusha")
    await userEvent.keyboard("{Backspace}")
    expect(box).toHaveValue("arush")
    expect(screen.getByRole("status")).toHaveTextContent("none")
  })

  it("moves the list above the box when a phone keyboard leaves no room below it", async () => {
    // The box sits 250 to 302px down a 768px page; the keyboard then leaves the top 300px visible.
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.classList.contains("gf-ta") ? ({ top: 250, bottom: 302, left: 16, right: 374, width: 358, height: 52, x: 16, y: 250 } as DOMRect) : new DOMRect()
    })
    const listeners: Record<string, () => void> = {}
    const viewport = { offsetTop: 0, height: 768, addEventListener: (e: string, f: () => void) => (listeners[e] = f), removeEventListener: () => {} }
    vi.stubGlobal("visualViewport", viewport)
    try {
      render(<Region />)
      await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
      const panel = document.querySelector<HTMLElement>(".gf-ta-panel")!
      await vi.waitFor(() => expect(panel.style.top).toBe("308px"))
      expect(panel).not.toHaveAttribute("data-above")

      viewport.height = 300
      act(() => listeners.resize())
      expect(panel).toHaveAttribute("data-above")
      expect(panel.style.top).toBe("")
      expect(panel.style.bottom).toBe(`${window.innerHeight - 250 + 6}px`)
      expect(panel.style.maxHeight).toBe("232px")
    } finally {
      rect.mockRestore()
      vi.unstubAllGlobals()
    }
  })

  it("picks with a click", async () => {
    render(<Region />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    await userEvent.click(screen.getByRole("option", { name: "Outside Tanzania (Other Country)" }))
    expect(screen.getByRole("status")).toHaveTextContent("Outside Tanzania")
  })
})

function LastName() {
  const [father, setFather] = useState({ fatherMiddle: "", fatherLast: "" })
  const [from, setFrom] = useState<LastNameFrom>("father_last")
  return (
    <>
      <input aria-label="Middle" value={father.fatherMiddle} onChange={(e) => setFather({ ...father, fatherMiddle: e.target.value })} />
      <input aria-label="Last" value={father.fatherLast} onChange={(e) => setFather({ ...father, fatherLast: e.target.value })} />
      <LastNameChoice name="ln" father={father} value={from} onChange={setFrom} labels={{ group: "Student’s last name", last: "Father’s last name", middle: "Father’s middle name" }} />
      <output>{from}</output>
    </>
  )
}

describe("LastNameChoice", () => {
  it("opens once the father's middle and last names are in, with his last name picked", async () => {
    render(<LastName />)
    // Shut, the choice is inert: Tab and clicks skip it.
    const group = screen.getByRole("radiogroup", { name: "Student’s last name" })
    const fold = group.closest(".gf-reveal")
    expect(fold).toHaveAttribute("inert")
    await userEvent.type(screen.getByLabelText("Middle"), "salim")
    expect(fold).toHaveAttribute("inert")
    await userEvent.type(screen.getByLabelText("Last"), "mrisho")
    expect(fold).not.toHaveAttribute("inert")
    expect(within(group).getByRole("radio", { name: /Father’s last name\s*MRISHO/ })).toBeChecked()
    await userEvent.click(within(group).getByRole("radio", { name: /Father’s middle name\s*SALIM/ }))
    expect(screen.getByRole("status")).toHaveTextContent("father_middle")
  })
})

describe("ChoiceTiles pair", () => {
  it("draws each choice with its line under it", async () => {
    const onChange = vi.fn()
    render(
      <ChoiceTiles
        name="who"
        layout="pair"
        legend="Who is the custodian?"
        value={null}
        onChange={onChange}
        options={[
          { value: "father", label: "The father", description: "JUMA SALIM MRISHO" },
          { value: "else", label: "Someone else", description: "Mother, guardian or another person" },
        ]}
      />,
    )
    await userEvent.click(screen.getByRole("radio", { name: /The father\s*JUMA SALIM MRISHO/ }))
    expect(onChange).toHaveBeenCalledWith("father")
  })
})

describe("ProgressBar endReset", () => {
  const base = {
    groups: [{ label: "Students", steps: 3, done: 1 }],
    activeGroup: 0,
    onBack: () => {},
    labels: { back: "Back", reset: "Start over" },
    status: "",
  }

  it("keeps Start over on the left on the first question, and after the section chip from the second on", async () => {
    const onReset = vi.fn()
    const { container, rerender } = render(<ProgressBar {...base} canBack={false} canReset endReset onReset={onReset} />)
    expect(screen.getAllByRole("button", { name: "Start over" })).toHaveLength(1)
    expect(screen.getByRole("button", { name: "Start over" }).closest(".gf-navslot")).not.toBeNull()

    rerender(<ProgressBar {...base} canBack canReset endReset onReset={onReset} />)
    const end = screen.getByRole("button", { name: "Start over" })
    expect(end.closest(".gf-navslot")).toBeNull()
    expect(container.querySelector(".gf-secname")?.nextElementSibling).toBe(end)
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument()
    await userEvent.click(end)
    expect(onReset).toHaveBeenCalledTimes(1)
  })

  it("shows no end button without endReset", () => {
    render(<ProgressBar {...base} canBack canReset onReset={() => {}} />)
    expect(screen.queryByRole("button", { name: "Start over" })).toBeNull()
  })
})
