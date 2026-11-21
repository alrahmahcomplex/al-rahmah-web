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

  // Owner, #511: "I want the Dropdown to scroll on view when clicked and to Open Downward as an Overlay".
  it("opens below the box and, when a phone keyboard opens, scrolls up to stay visible above it", async () => {
    // The box starts 250 to 302px down the page; scrolling moves it up.
    let scrolled = 0
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("gf-ta")) return new DOMRect()
      return { top: 250 - scrolled, bottom: 302 - scrolled, left: 16, right: 374, width: 358, height: 52, x: 16, y: 250 - scrolled } as DOMRect
    })
    const page = document.documentElement
    const scrollBy = vi.fn((o: ScrollToOptions) => {
      scrolled += o.top ?? 0
    })
    Object.defineProperty(page, "scrollBy", { value: scrollBy, configurable: true })
    const listeners: Record<string, () => void> = {}
    const viewport = { offsetTop: 0, height: 768, addEventListener: (e: string, f: () => void) => (listeners[e] = f), removeEventListener: () => {} }
    vi.stubGlobal("visualViewport", viewport)
    try {
      render(<Region />)
      await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
      const panel = document.querySelector<HTMLElement>(".gf-ta-panel")!
      // Room enough below: no scroll, and the list opens just under the box.
      await vi.waitFor(() => expect(panel.style.top).toBe("308px"))
      expect(panel.style.maxHeight).toBe("380px")
      expect(scrollBy).not.toHaveBeenCalled()

      // The keyboard leaves the top 340px: the box scrolls up, room is added at the page's foot, and the list stays below.
      viewport.height = 340
      act(() => listeners.resize())
      expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ top: 162 }))
      expect(page.style.paddingBottom).not.toBe("")
      await vi.waitFor(() => expect(panel.style.top).toBe("146px"))
      expect(panel.style.maxHeight).toBe("182px")
      expect(146 + 182).toBeLessThanOrEqual(viewport.height)

      // Closing the list takes the added room away.
      await userEvent.keyboard("{Escape}")
      expect(page.style.paddingBottom).toBe("")
    } finally {
      rect.mockRestore()
      delete (page as unknown as Record<string, unknown>).scrollBy
      vi.unstubAllGlobals()
    }
  })

  it("never makes the list taller than the room a short keyboard viewport leaves, under the form's sticky bar", async () => {
    // The box starts 250 to 302px down the page, in a form whose sticky bar is 62px tall.
    let scrolled = 0
    const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      if (!this.classList.contains("gf-ta")) return new DOMRect()
      return { top: 250 - scrolled, bottom: 302 - scrolled, left: 16, right: 374, width: 358, height: 52, x: 16, y: 250 - scrolled } as DOMRect
    })
    const page = document.documentElement
    Object.defineProperty(page, "scrollBy", { value: (o: ScrollToOptions) => void (scrolled += o.top ?? 0), configurable: true })
    const listeners: Record<string, () => void> = {}
    const viewport = { offsetTop: 0, height: 768, addEventListener: (e: string, f: () => void) => (listeners[e] = f), removeEventListener: () => {} }
    vi.stubGlobal("visualViewport", viewport)
    try {
      const { container } = render(
        <div>
          <div className="gf-bar-row" />
          <Region />
        </div>,
      )
      Object.defineProperty(container.querySelector(".gf-bar-row"), "offsetHeight", { value: 62 })
      await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
      const panel = document.querySelector<HTMLElement>(".gf-ta-panel")!
      await vi.waitFor(() => expect(panel.style.top).toBe("308px"))

      // The keyboard leaves only the top 235px: the box stops under the bar, and the list ends above the keyboard.
      viewport.height = 235
      act(() => listeners.resize())
      await vi.waitFor(() => expect(panel.style.top).toBe("128px"))
      expect(scrolled).toBe(180)
      expect(panel.style.maxHeight).toBe("95px")
      expect(128 + 95).toBeLessThanOrEqual(viewport.height)
    } finally {
      rect.mockRestore()
      delete (page as unknown as Record<string, unknown>).scrollBy
      vi.unstubAllGlobals()
    }
  })

  it("shows the faint completion after leading spaces and keeps the typed text in the box", async () => {
    const { container } = render(<Region />)
    const box = screen.getByRole("combobox", { name: "Region" })
    await userEvent.type(box, "  pw")
    expect(box).toHaveValue("  pw")
    expect(container.querySelector(".gf-ta-typed")).toHaveTextContent("  pw", { normalizeWhitespace: false })
    expect(container.querySelector(".gf-ta-rest")).toHaveTextContent("ani")
    await userEvent.keyboard("{ArrowRight}")
    expect(box).toHaveValue("Pwani")
  })

  it("picks with a click", async () => {
    render(<Region />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    await userEvent.click(screen.getByRole("option", { name: "Outside Tanzania (Other Country)" }))
    expect(screen.getByRole("status")).toHaveTextContent("Outside Tanzania")
  })
})

function Row() {
  return (
    <>
      <input aria-label="Before" />
      <Region />
      <input aria-label="After" />
    </>
  )
}

const COUNTRY_OPTIONS: TypeAheadOption[] = [
  { value: "Kenya", label: "Kenya" },
  { value: "Uganda", label: "Uganda" },
]
const COUNTRY_LABELS = {
  field: "Country",
  placeholder: "Type or choose a country",
  showAll: "Show all countries",
  search: "Search countries",
  list: "Countries",
  none: (q: string) => `No country matches “${q}”.`,
}

function RegionWithCountry() {
  const [region, setRegion] = useState("")
  const [country, setCountry] = useState("")
  return (
    <>
      <input aria-label="Before" />
      <TypeAheadField
        options={OPTIONS}
        pinned="Outside Tanzania"
        value={region}
        onValueChange={(v) => {
          setRegion(v)
          if (v !== "Outside Tanzania") setCountry("")
        }}
        labels={LABELS}
      />
      {region === "Outside Tanzania" && (
        <TypeAheadField options={COUNTRY_OPTIONS} value={country} onValueChange={setCountry} labels={COUNTRY_LABELS} />
      )}
      <input aria-label="After" />
    </>
  )
}

describe("TypeAheadField, Tab from the list's search", () => {
  const openAndType = async (letters: string) => {
    render(<Row />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    await userEvent.type(screen.getByRole("combobox", { name: "Search regions" }), letters)
  }

  it("takes the faint match and moves to the field after the box", async () => {
    await openAndType("kag")
    await userEvent.tab()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("combobox", { name: "Region" })).toHaveValue("Kagera")
    expect(screen.getByLabelText("After")).toHaveFocus()
  })

  it("lands on the conditional country field after picking Outside Tanzania with Tab", async () => {
    render(<RegionWithCountry />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    await userEvent.type(screen.getByRole("combobox", { name: "Search regions" }), "out")
    await userEvent.tab()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("combobox", { name: "Region" })).toHaveValue("Outside Tanzania (Other Country)")
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveFocus()
  })

  it("lands on the conditional country field after taking Outside Tanzania with Tab in the main box", async () => {
    render(<RegionWithCountry />)
    await userEvent.type(screen.getByRole("combobox", { name: "Region" }), "out")
    await userEvent.tab()
    expect(screen.getByRole("combobox", { name: "Region" })).toHaveValue("Outside Tanzania (Other Country)")
    expect(screen.getByRole("combobox", { name: "Country" })).toHaveFocus()
  })

  it("moves on without picking when nothing matches", async () => {
    await openAndType("zz")
    await userEvent.tab()
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("none")
    expect(screen.getByLabelText("After")).toHaveFocus()
  })

  it("goes back to the field before the box with Shift+Tab, picking nothing", async () => {
    await openAndType("kag")
    await userEvent.tab({ shift: true })
    expect(screen.queryByRole("listbox")).toBeNull()
    expect(screen.getByRole("status")).toHaveTextContent("none")
    expect(screen.getByLabelText("Before")).toHaveFocus()
  })
})

describe("TypeAheadField for a screen reader", () => {
  it("says the faint match, which is not in the box, and names the list behaviour", async () => {
    const { container } = render(<Region />)
    const box = screen.getByRole("combobox", { name: "Region" })
    expect(box).toHaveAttribute("aria-autocomplete", "list")
    const said = container.querySelector("[data-ta-suggestion]")
    expect(said).toHaveAttribute("aria-live", "polite")
    expect(said).toHaveTextContent("")
    await userEvent.type(box, "kag")
    expect(box).toHaveValue("kag")
    expect(said).toHaveTextContent("Kagera")
    await userEvent.keyboard("{Escape}")
    expect(said).toHaveTextContent("")
  })

  it("uses aria-autocomplete=list and a polite live region on the popup search", async () => {
    render(<Region />)
    await userEvent.click(screen.getByRole("button", { name: "Show all regions" }))
    const find = screen.getByRole("combobox", { name: "Search regions" })
    expect(find).toHaveAttribute("aria-autocomplete", "list")
    const said = document.body.querySelector("[data-ta-search-suggestion]")
    expect(said).toHaveAttribute("aria-live", "polite")
    expect(said).toHaveTextContent("")
    await userEvent.type(find, "kag")
    expect(find).toHaveValue("kag")
    expect(said).toHaveTextContent("Kagera")
    await userEvent.clear(find)
    expect(said).toHaveTextContent("")
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
